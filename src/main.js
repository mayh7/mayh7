import { Actor } from 'apify'; 
import { PlaywrightCrawler, Dataset } from 'crawlee';

// Inicializa o Actor (essencial para rodar na plataforma)
await Actor.init();

const startUrls = [
    'https://www.olx.pt/carros-motos-e-barcos/carros/aveiro/?search%5Bprivate_business%5D=private&search%5Bfilter_float_year%3Afrom%5D=2019&search%5Bfilter_float_quilometros%3Ato%5D=120000'
];

// Configuração de Proxy
// Se der erro de proxy depois, troque groups: ['RESIDENTIAL'] por groups: ['AUTO'] ou remova o objeto de dentro dos parênteses.
const proxyConfiguration = await Actor.createProxyConfiguration({ 
    groups: ['RESIDENTIAL'] 
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    
    requestHandler: async ({ page, request, enqueueLinks, log }) => {
        log.info(`Processando: ${request.url}`);

        // --- LISTAGEM ---
        if (request.label === 'LIST') {
            await page.waitForSelector('[data-cy="l-card"]');
            await enqueueLinks({
                selector: '[data-cy="l-card"] a',
                label: 'DETAIL',
            });
            const nextButton = await page.$('[data-cy="pagination-forward"]');
            if (nextButton) {
                await enqueueLinks({
                    selector: '[data-cy="pagination-forward"]',
                    label: 'LIST',
                });
            }
        } 
        
        // --- DETALHE DO CARRO ---
        else if (request.label === 'DETAIL') {
            await page.waitForSelector('h1');

            let telefone = 'Não disponível';
            try {
                // Tenta clicar no botão de mostrar telefone
                const phoneBtn = await page.$('button[data-testid="show-phone"]'); // Ajustar seletor se necessário
                if (phoneBtn) {
                    await phoneBtn.click();
                    await page.waitForTimeout(2000); 
                    // Tenta pegar o texto que apareceu
                    telefone = await page.evaluate(() => {
                         // Procura o elemento que contem o telefone após o clique
                         const el = document.querySelector('button[data-testid="show-phone"]');
                         return el ? el.innerText : 'Erro ao ler';
                    });
                }
            } catch (e) {
                log.warning(`Não foi possível pegar telefone: ${e.message}`);
            }

            const dados = await page.evaluate(() => {
                const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
                const attributes = {};
                
                // Pega os itens da lista de detalhes (Ano, Km, etc)
                document.querySelectorAll('[data-testid="main-parameters"] li').forEach(li => {
                    const text = li.innerText;
                    if(text.includes('Ano')) attributes.ano = text.replace('Ano: ', '');
                    if(text.includes('Quilómetros')) attributes.km = text.replace('Quilómetros: ', '');
                    if(text.includes('Modelo')) attributes.modelo = text.replace('Modelo: ', '');
                });

                return {
                    nome: getText('h1'),
                    descricao: getText('[data-cy="ad_description"] div'),
                    cidade: getText('[data-testid="location-date"]')?.split('-')[0]?.trim(),
                    preco: getText('[data-testid="ad-price-container"] h3'),
                    ...attributes
                };
            });

            await Dataset.pushData({
                url: request.url,
                telefone,
                particular: true,
                ...dados
            });
        }
    },
});

await crawler.run(startUrls.map(url => ({ url, label: 'LIST' })));

// Finaliza o Actor corretamente
await Actor.exit();
