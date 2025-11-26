import { PlaywrightCrawler, Dataset } from 'crawlee';

// URLs iniciais (você pode passar isso via Input do Apify depois, mas deixei fixo para o teste)
const startUrls = [
    'https://www.olx.pt/carros-motos-e-barcos/carros/aveiro/?search%5Bprivate_business%5D=private&search%5Bfilter_float_year%3Afrom%5D=2019&search%5Bfilter_float_quilometros%3Ato%5D=120000'
];

const crawler = new PlaywrightCrawler({
    // Usa proxies do Apify para evitar bloqueio (essencial para OLX)
    // Se estiver rodando local sem conta paga, pode comentar a linha abaixo, mas no servidor precisa.
    proxyConfiguration: await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] }), 
    
    requestHandler: async ({ page, request, enqueueLinks, log }) => {
        log.info(`Processando: ${request.url}`);

        // --- CENÁRIO 1: PÁGINA DE LISTAGEM (Categoria) ---
        if (request.label === 'LIST') {
            // 1. Espera os anúncios carregarem
            await page.waitForSelector('[data-cy="l-card"]');

            // 2. Enfileira os links de cada carro para serem visitados
            await enqueueLinks({
                selector: '[data-cy="l-card"] a',
                label: 'DETAIL', // Marca como página de detalhe
            });

            // 3. Tenta achar o botão de "Próxima Página" e enfileira
            // O seletor do botão de próxima página varia, mas geralmente é algo assim:
            const nextButton = await page.$('[data-cy="pagination-forward"]');
            if (nextButton) {
                await enqueueLinks({
                    selector: '[data-cy="pagination-forward"]',
                    label: 'LIST',
                });
            }
        } 
        
        // --- CENÁRIO 2: PÁGINA DE DETALHE (O carro) ---
        else if (request.label === 'DETAIL') {
            // Espera o título carregar
            await page.waitForSelector('h1');

            // --- TENTATIVA DE PEGAR O TELEFONE ---
            let telefone = 'Não disponível';
            try {
                // Tenta clicar no botão de mostrar telefone (seletor sujeito a mudança)
                // O seletor comum no OLX costuma ser data-testid ou classes específicas
                const phoneBtn = await page.$('button[data-testid="show-phone"]');
                if (phoneBtn) {
                    await phoneBtn.click();
                    await page.waitForTimeout(1000); // Espera revelar
                    // Pega o texto do botão ou do elemento que apareceu
                    telefone = await page.textContent('button[data-testid="show-phone"]'); 
                }
            } catch (e) {
                log.warning(`Não foi possível pegar telefone de ${request.url}`);
            }

            // --- EXTRAÇÃO DOS DADOS ---
            const dados = await page.evaluate(() => {
                // Função auxiliar para pegar texto seguro
                const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';

                // Pegar atributos (Ano, Km, etc ficam numa lista)
                // O layout do OLX PT geralmente usa uma lista <ul> com <li>
                // Vamos varrer essa lista para mapear chaves e valores
                const attributes = {};
                document.querySelectorAll('[data-testid="main-parameters"] li').forEach(li => {
                    const text = li.innerText;
                    if(text.includes('Ano')) attributes.ano = text.replace('Ano: ', '');
                    if(text.includes('Quilómetros')) attributes.km = text.replace('Quilómetros: ', '');
                    if(text.includes('Modelo')) attributes.modelo = text.replace('Modelo: ', '');
                });

                return {
                    nome: getText('h1'), // Título do anúncio
                    vendedor: getText('h4'), // Nome do vendedor (geralmente h4 no card de user)
                    descricao: getText('[data-cy="ad_description"] div'),
                    cidade: getText('[data-testid="location-date"]')?.split('-')[0]?.trim(), // Pega só a cidade
                    preco: getText('[data-testid="ad-price-container"] h3'),
                    ...attributes
                };
            });

            // Salva no Dataset do Apify
            await Dataset.pushData({
                url: request.url,
                telefone,
                particular: true, // Já filtramos na URL, então é true
                ...dados
            });
        }
    },
});

// Começa a rodar
await crawler.run(startUrls.map(url => ({ url, label: 'LIST' })));
