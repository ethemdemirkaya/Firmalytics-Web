import puppeteer from 'puppeteer';
import pLimit from 'p-limit';
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let isCancelled = false;

const log = (io, message, type = "INFO") => {
    if (io) {
        io.emit('log', message);
    }
};

async function hizliSiteAnalizi(url, timeoutSec) {
    const result = { 
        eposta: "Bulunamadı", 
        linkedIn: "Bulunamadı",
        aciklama: "Belirtilmemiş", 
        teknolojiler: [],
    };

    if (!url) return result;
    if (!url.startsWith('http')) url = 'https://' + url;

    try {
        const response = await axios.get(url, {
            timeout: timeoutSec * 1000,
            httpsAgent: httpsAgent,
            maxRedirects: 3,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html',
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);
        
        $('script, style, svg, noscript, header, footer').remove();
        const textContent = $('body').text().replace(/\s+/g, ' ').trim().toLowerCase();

        // 1. E-Posta
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
        
        $('a[href^="mailto:"]').each((i, el) => {
            const m = $(el).attr('href').replace('mailto:', '').split('?')[0];
            if(m && !m.includes('example') && !m.includes('domain')) result.eposta = m;
        });
        
        if (result.eposta === "Bulunamadı") {
            const matches = html.match(emailRegex);
            if (matches) {
                const valid = matches.find(e => !e.match(/\.(png|jpg|jpeg|webp|gif|js|css)$/i));
                if(valid) result.eposta = valid;
            }
        }
        $('a[href]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (!href) return;
            if (href.includes('linkedin.com/company') || href.includes('linkedin.com/in')) result.linkedIn = href;
        });

        const metaDesc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content');
        if (metaDesc) result.aciklama = metaDesc.substring(0, 150) + "...";

        const techMap = [
            { key: "E-Ticaret", terms: ["e-ticaret", "shopify", "woocommerce", "opencart", "magento"] },
            { key: "Yazılım/App", terms: ["yazılım", "mobil uygulama", "ios", "android", "react", "vue"] },
            { key: "Dijital Ajans", terms: ["reklam", "seo", "sosyal medya yönetimi", "dijital pazarlama"] },
            { key: "Kurumsal", terms: ["inşaat", "danışmanlık", "hukuk", "muhasebe"] }
        ];

        const sampleText = textContent.substring(0, 5000);
        
        techMap.forEach(tech => {
            if (tech.terms.some(term => sampleText.includes(term))) {
                result.teknolojiler.push(tech.key);
            }
        });

    } catch (error) {
    }
    return result;
}

export default async function handler(req, res) {
    const io = res.socket.server.io;
    
    if (!io) {
        return res.status(500).json({ error: "Soket sunucusu hazır değil." });
    }

    if (req.method === 'POST') {
        const { action } = req.body;

        if (action === 'stop') {
            isCancelled = true;
            return res.status(200).json({ message: 'Durduruldu' });
        }
        
        isCancelled = false;
        
        googleAramaMotoru(io, req.body).catch(err => {
            console.error("Scrape Hatası:", err);
            io.emit('log', "Kritik Hata: " + err.message);
        });

        return res.status(200).json({ message: 'İşlem başlatıldı' });
    }
}

async function googleAramaMotoru(io, options) {
    const { konum, anahtarKelime, maksSonuc, ePostaAramasiYapilsin, websiteTimeout } = options;
    const CONCURRENCY_LIMIT = 5; 
    const limit = pLimit(CONCURRENCY_LIMIT);
    
    log(io, `🚀 Analiz Başlatılıyor: ${konum} - ${anahtarKelime}`);

    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--lang=tr-TR,tr'
        ] 
    });
    
    const processedLinks = new Set();
    const activeTasks = []; 

    try {
        const mainPage = await browser.newPage();
        await mainPage.setViewport({ width: 1400, height: 900 });
        
        await mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(konum)}+${encodeURIComponent(anahtarKelime)}`;
        log(io, "🔗 Google Maps açılıyor...");
        
        await mainPage.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        try {
            const cookieButtons = ["button[aria-label*='Kabul et']", "button[aria-label*='Accept all']", "form[action*='consent'] button"];
            for (const selector of cookieButtons) {
                const btn = await mainPage.$(selector);
                if (btn) { await btn.click(); await new Promise(r => setTimeout(r, 2000)); break; }
            }
        } catch (e) {}
        const feedSelector = "div[role='feed']";
        
        try {
            await mainPage.waitForSelector(feedSelector, { timeout: 10000 });
            log(io, "⚡ Liste alanı bulundu, tarama başlıyor...");
        } catch (e) {
             // Liste bulunamadıysa tekil sonuç kontrolü
             const isSingleResult = await mainPage.$('h1.DUwDvf');
             if (isSingleResult) {
                 log(io, "🎯 Tek bir sonuç bulundu.");
                 const task = limit(() => scrapeDetailFast(browser, mainPage.url(), io, ePostaAramasiYapilsin, websiteTimeout));
                 activeTasks.push(task);
                 await Promise.all(activeTasks);
                 await browser.close();
                 return;
             }
             log(io, "❌ Liste alanı yüklenemedi. Tekrar deneyin.", "ERROR");
             await browser.close();
             return;
        }

        let sameCount = 0;
        
        while (processedLinks.size < maksSonuc && !isCancelled) {
            const links = await mainPage.evaluate((feedSel) => {
                const feed = document.querySelector(feedSel);
                if(!feed) return [];
                return Array.from(feed.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.includes('/maps/place/'));
            }, feedSelector);

            let newLinkFound = false;
            for (const link of links) {
                if (processedLinks.size >= maksSonuc) break;
                if (!processedLinks.has(link)) {
                    processedLinks.add(link);
                    newLinkFound = true;
                    const task = limit(() => scrapeDetailFast(browser, link, io, ePostaAramasiYapilsin, websiteTimeout));
                    activeTasks.push(task);
                }
            }
            
            io.emit('progress', Math.min(95, Math.round((processedLinks.size / maksSonuc) * 100)));
            log(io, `📥 Toplanan: ${processedLinks.size} / ${maksSonuc}`);

            if (processedLinks.size >= maksSonuc) break;

            try {
                await mainPage.hover(feedSelector);
                
                await mainPage.mouse.wheel({ deltaY: 2000 });
                await new Promise(r => setTimeout(r, 1000));
                
                await mainPage.mouse.wheel({ deltaY: 2000 });
                await new Promise(r => setTimeout(r, 1000));

                await mainPage.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if(el) el.scrollTop = el.scrollHeight;
                }, feedSelector);

                await new Promise(r => setTimeout(r, 2000));
            } catch (scrollErr) {
                console.log("Scroll hatası:", scrollErr);
            }

            if (!newLinkFound) {
                sameCount++;
                log(io, `⏳ Yükleniyor... (${sameCount}/5)`);
                if (sameCount >= 5) {
                    log(io, "⚠️ Daha fazla sonuç yüklenemedi (Listenin sonu olabilir).", "WARN");
                    break;
                }
            } else {
                sameCount = 0;
            }
        }

    } catch (error) {
        log(io, `Kritik Hata: ${error.message}`, "ERROR");
    }

    log(io, "✅ Tarama bitti, son detaylar işleniyor...", "SUCCESS");
    await Promise.all(activeTasks);
    await browser.close();
    io.emit('finished');
}
async function scrapeDetailFast(browser, link, io, ePostaAramasiYapilsin, websiteTimeout) {
    if (isCancelled) return;

    let page;
    try {
        page = await browser.newPage();
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'media', 'font', 'stylesheet', 'other'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });

        try {
            await page.waitForSelector('h1', { timeout: 5000 });
        } catch (e) {
            await page.close();
            return;
        }

        const data = await page.evaluate(() => {
            const getTxt = (sel) => document.querySelector(sel)?.innerText?.trim() || "Bulunamadı";
            const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr)?.trim() || "Bulunamadı";

            const isletmeAdi = getTxt('h1');
            
            let telefon = getAttr("button[data-item-id^='phone:tel:']", "data-item-id")?.replace('phone:tel:', '') 
                         || getAttr("button[aria-label*='Telefon']", "aria-label")?.replace('Telefon:', '')?.trim()
                         || getTxt("button[data-item-id^='phone:tel:'] div.Io6YTe");

            let web = getAttr("a[data-item-id='authority']", "href") 
                     || getAttr("a[aria-label*='Web sitesi']", "href");

            let adres = getAttr("button[data-item-id='address']", "aria-label")?.replace('Adres:', '')?.trim()
                       || getTxt("button[data-item-id='address'] div.Io6YTe");

            const puan = getAttr("div.F7nice span[aria-hidden='true']", "aria-label")?.split(' ')[0] 
                        || getTxt("div.F7nice span[aria-hidden='true']");
            
            const yorumRaw = getAttr("div.F7nice span[aria-label]:not([aria-hidden])", "aria-label") || "";
            const yorumSayisi = yorumRaw.replace(/\D/g, '');

            const kategori = getTxt("button[jsaction*='category']");

            return {
                IsletmeAdi: isletmeAdi,
                Uzmanliklar: kategori !== "Bulunamadı" ? kategori : "",
                Telefon: telefon !== "Bulunamadı" ? telefon : "",
                WebSitesi: web !== "Bulunamadı" ? web : "Bulunamadı",
                Puan: puan !== "Bulunamadı" ? puan : "",
                YorumSayisi: yorumSayisi,
                Adres: adres !== "Bulunamadı" ? adres : ""
            };
        });

        await page.close();

        let ekBilgiler = { Eposta: "-", LinkedIn: "-", Aciklama: "-" };

        if (ePostaAramasiYapilsin && data.WebSitesi !== "Bulunamadı") {
            const analiz = await hizliSiteAnalizi(data.WebSitesi, websiteTimeout);
            ekBilgiler = {
                Eposta: analiz.eposta,
                LinkedIn: analiz.linkedIn,
                Aciklama: analiz.aciklama !== "Belirtilmemiş" ? analiz.aciklama : "",
                Uzmanliklar: data.Uzmanliklar + (analiz.teknolojiler.length > 0 ? ", " + analiz.teknolojiler.join(", ") : "")
            };
        }

        const finalData = {
            ...data,
            ...ekBilgiler,
            HaritaLinki: link
        };

        io.emit('yeni_sirket', finalData);

    } catch (err) {
        if (page && !page.isClosed()) await page.close();
    }
}