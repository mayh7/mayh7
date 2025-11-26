import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

// --- CONFIGURAÇÃO ---
const START_URL = 'https://www.olx.pt/carros-motos-e-barcos/carros/aveiro/?search%5Bprivate_business%5D=private&search%5Bfilter_float_year%3Afrom%5D=2019&search%5Bfilter_float_quilometros%3Ato%5D=120000';

// Usa 'AUTO' para o Apify escolher o melhor proxy disponível no seu plano
const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['AUTO'], 
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    // Aumenta o timeout de navegação para 60 segundos
    navigationTimeoutSecs: 60,
    // Diminui o número de tentativas em caso de erro para não travar
    maxRequestRetries: 2,

    requestHandler: async ({ page, request, enqueueLinks, log }) => {
        log.info(`📍 Visitando: ${request.url}`);

        // --- TENTA FECHAR O COOKIE BANNER (Comum travar aqui) ---
        try {
            // Procura botões comuns de aceitar cookies no OLX
            const cookieBtn = await page.$('#onetrust-accept-btn-handler');
            if (cookieBtn) {
                log.info('🍪 Aceitando cookies...');
                await cookieBtn.click();
                await page.waitForTimeout(1000); // Espera o banner sumir
            }
        } catch (e) {
            // Ignora se não achar o banner
        }

        // --- PÁGINA DE LISTAGEM ---
        if (request.label === 'LIST') {
            log.info('🔎 Procurando anúncios na lista...');
            
            // Espera aparecer qualquer cartão de anúncio (timeout curto para não travar)
            try {
                await page.waitForSelector('[data-cy="l-card"]', { timeout: 15000 });
            } catch(e) {
                log.error('❌ Não encontrou anúncios. O OLX pode ter bloqueado ou o seletor mudou.');
                // Tira um print para você ver o erro no Apify (na aba Key-Value Store)
                await page.screenshot({ path: 'erro-lista.png' });
                return; // Para essa execução
            }

            // Enfileira os carros
            const info = await enqueueLinks({
                selector: '[data-cy="l-card"] a',
                label: 'DETAIL',
            });
            log.info(`✅ Encontrou ${info.processedRequests.length} carros nesta página.`);
        } 
        
        // --- PÁGINA DE DETALHE DO CARRO ---
        else if (request.label === 'DETAIL') {
            log.info('🚗 Extraindo dados do carro...');
            
            // Espera o título principal
            await page.waitForSelector('h1', { timeout: 15000 });

            // Tenta pegar telefone
            let telefone = 'Botão não encontrado';
            try {
                // Tenta clicar no botão de mostrar telefone
                const phoneBtn = await page.$('[data-testid="show-phone"]'); // Seletor ajustado
                if (phoneBtn) {
                    await phoneBtn.click();
                    // Espera um pouco para o número aparecer
                    await page.waitForTimeout(2000);
                    // Pega o texto do próprio botão ou do container
                    telefone = await page.textContent('[data-testid="show-phone"]'); 
                }
            } catch (e) {
                telefone = 'Erro ao clicar';
            }

            // Extração dos dados
            const dados = await page.evaluate(() => {
                const safeText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
                
                const data = {
                    titulo: safeText('h1'),
                    preco: safeText('[data-testid="ad-price-container"] h3'),
                    descricao: safeText('[data-cy="ad_description"] div'),
                    cidade: safeText('[data-testid="location-date"]')?.split('-')[0]?.trim(),
                    ano: '',
                    km: '',
                    modelo: ''
                };

                // Varre a lista de parametros (Ano, Km, etc)
                const params = document.querySelectorAll('[data-testid="main-parameters"] li');
                params.forEach(li => {
                    const txt = li.innerText;
                    if(txt.includes('Ano')) data.ano = txt.replace('Ano: ', '').trim();
                    if(txt.includes('Quilómetros')) data.km = txt.replace('Quilómetros: ', '').trim();
                    if(txt.includes('Modelo')) data.modelo = txt.replace('Modelo: ', '').trim();
                });

                return data;
            });

            // Salva o resultado
            await Dataset.pushData({
                url: request.url,
                telefone,
                ...dados
            });
            log.info(`💾 Carro salvo: ${dados.titulo}`);
        }
    },
});

await crawler.run([{ url: START_URL, label: 'LIST' }]);

await Actor.exit();
