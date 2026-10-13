import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { PlaywrightCrawler, log } from 'crawlee';
import {
    extractPwsData,
    parsePinData,
    parsePinHtmlFallback,
    parseBoardData,
    parseProfileData
} from './extractors.js';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    mode = 'AUTO_DETECT',
    targetUrls = [],
    searchKeywords = [],
    maxItems = 50,
    extractVideos = true,
    proxyConfiguration
} = input;

log.info('🚀 Starting Pinterest Ultimate Scraper...', {
    mode,
    targetUrlsCount: targetUrls.length,
    searchKeywordsCount: searchKeywords.length
});

const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

// Default sample targets if nothing provided
let urlsToProcess = [...targetUrls];
let keywordsToProcess = [...searchKeywords];

if (urlsToProcess.length === 0 && keywordsToProcess.length === 0) {
    urlsToProcess = [
        'https://www.pinterest.com/pin/861594972476596163/',
        'https://www.pinterest.com/nike/'
    ];
    log.info('ℹ️ No inputs provided. Defaulting to sample Pinterest targets:', { urls: urlsToProcess });
}

function buildHeaders() {
    return {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1'
    };
}

// Fast HTML fetcher
async function fetchHtml(url) {
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    const response = await gotScraping({
        url,
        headers: buildHeaders(),
        proxyUrl,
        timeout: { request: 25000 },
        retry: { limit: 2 }
    });
    return response.body;
}

// Playwright crawler fallback
async function fetchWithPlaywright(url) {
    let content = '';
    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxRequestsPerCrawl: 1,
        headless: true,
        requestHandlerTimeoutSecs: 35,
        async requestHandler({ page }) {
            // Dismiss cookie consent popup if present
            try {
                const acceptBtn = page.locator('button:has-text("Accept"), button:has-text("Got it")');
                if (await acceptBtn.isVisible({ timeout: 2000 })) {
                    await acceptBtn.click();
                }
            } catch (_) {}

            content = await page.content();
        }
    });
    await crawler.run([url]);
    return content;
}

// Auto-detect mode per URL
function detectUrlMode(url, explicitMode) {
    if (explicitMode && explicitMode !== 'AUTO_DETECT') return explicitMode;
    const lower = url.toLowerCase();
    if (lower.includes('/pin/')) return 'PINS';
    if (lower.includes('/search/')) return 'SEARCH';

    const cleanPath = url.replace(/https?:\/\/(?:www\.)?pinterest\.com\/?/i, '').replace(/\/+$/, '');
    const parts = cleanPath.split('/').filter(Boolean);
    if (parts.length >= 2) return 'BOARDS';
    if (parts.length === 1) return 'PROFILES';

    return 'PINS';
}

const stats = {
    pins: 0,
    boards: 0,
    profiles: 0,
    searchResults: 0,
    failed: 0
};

// 1. PROCESS TARGET URLS
for (const rawUrl of urlsToProcess) {
    const url = rawUrl.trim();
    if (!url) continue;

    const currentMode = detectUrlMode(url, mode);
    log.info(`🎯 Processing [${currentMode}]: ${url}`);

    try {
        let html = '';
        try {
            html = await fetchHtml(url);
        } catch (fetchErr) {
            log.warning(`⚠️ HTTP fetch error for ${url} (${fetchErr.message}). Fallback to browser...`);
            html = await fetchWithPlaywright(url);
        }

        const pwsData = extractPwsData(html);

        // 1. PIN MODE
        if (currentMode === 'PINS') {
            let pin = null;

            // Try deep PWS extraction
            if (pwsData?.props?.initialReduxState?.pins) {
                const pinsMap = pwsData.props.initialReduxState.pins;
                const pinObj = Object.values(pinsMap)[0];
                if (pinObj) {
                    pin = parsePinData(pinObj, html);
                }
            }

            // Fallback to HTML meta & JSON-LD
            if (!pin) {
                pin = parsePinHtmlFallback(html, url);
            }

            if (pin) {
                if (!extractVideos && pin.isVideo) {
                    delete pin.videoUrl;
                }
                await Actor.pushData(pin);
                stats.pins++;
                log.info(`✅ Successfully scraped Pin: "${pin.title || pin.id}" [Outbound: ${pin.domain || 'None'}, Saves: ${pin.saveCount}]`);
            } else {
                log.warning(`⚠️ Could not parse Pin data from ${url}`);
            }
        }

        // 2. BOARDS MODE
        else if (currentMode === 'BOARDS') {
            const board = parseBoardData(html, url);
            if (board) {
                await Actor.pushData(board);
                stats.boards++;
                log.info(`✅ Successfully scraped Board: "${board.title}"`);
            }

            // Also extract pins inside board if available
            if (pwsData?.props?.initialReduxState?.pins) {
                const pinsMap = pwsData.props.initialReduxState.pins;
                const pinList = Object.values(pinsMap).slice(0, maxItems);
                for (const pinObj of pinList) {
                    const p = parsePinData(pinObj, html);
                    if (p) {
                        await Actor.pushData(p);
                        stats.pins++;
                    }
                }
                log.info(`📌 Extracted ${pinList.length} pins from board: ${board?.title || url}`);
            }
        }

        // 3. PROFILES MODE
        else if (currentMode === 'PROFILES') {
            const profile = parseProfileData(html, url);
            if (profile) {
                await Actor.pushData(profile);
                stats.profiles++;
                log.info(`✅ Successfully scraped Creator: "${profile.authorName}" [Monthly Views: ${profile.authorMonthlyViews || 'N/A'}]`);
            }

            // Also extract recent pins by user
            if (pwsData?.props?.initialReduxState?.pins) {
                const pinsMap = pwsData.props.initialReduxState.pins;
                const pinList = Object.values(pinsMap).slice(0, maxItems);
                for (const pinObj of pinList) {
                    const p = parsePinData(pinObj, html);
                    if (p) {
                        await Actor.pushData(p);
                        stats.pins++;
                    }
                }
                log.info(`📌 Extracted ${pinList.length} recent pins from creator profile.`);
            }
        }

    } catch (err) {
        log.error(`❌ Error scraping ${url}: ${err.message}`);
        stats.failed++;
    }
}

// 2. PROCESS SEARCH KEYWORDS
if (keywordsToProcess.length > 0) {
    for (const keyword of keywordsToProcess) {
        log.info(`🔍 Searching Pinterest for keyword: "${keyword}"`);
        try {
            const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keyword)}`;
            let html = '';
            try {
                html = await fetchHtml(searchUrl);
            } catch (_) {
                html = await fetchWithPlaywright(searchUrl);
            }

            const pwsData = extractPwsData(html);
            let collected = 0;

            if (pwsData?.props?.initialReduxState?.pins) {
                const pinsMap = pwsData.props.initialReduxState.pins;
                const pinList = Object.values(pinsMap).slice(0, maxItems);

                for (const pinObj of pinList) {
                    const p = parsePinData(pinObj, html);
                    if (p) {
                        p.searchQuery = keyword;
                        await Actor.pushData(p);
                        collected++;
                        stats.searchResults++;
                    }
                }
            }

            log.info(`✅ Found and scraped ${collected} pins for keyword: "${keyword}"`);
        } catch (err) {
            log.error(`❌ Search error for "${keyword}": ${err.message}`);
            stats.failed++;
        }
    }
}

// Save summary report
const summary = {
    status: 'COMPLETED',
    timestamp: new Date().toISOString(),
    metrics: stats,
    totalRecordsExtracted: stats.pins + stats.boards + stats.profiles + stats.searchResults,
    message: 'Pinterest Ultimate Scraper completed successfully.'
};

await Actor.setValue('OUTPUT', summary);
log.info('🏁 Execution Finished. Executive Summary:', summary);

await Actor.exit();
