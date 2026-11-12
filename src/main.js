import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { PlaywrightCrawler, RequestQueue, log } from 'crawlee';
import {
    extractPwsData,
    getReduxState,
    isPinterestBlocked,
    parsePinData,
    parsePinHtmlFallback,
    parseBoardData,
    parseProfileData,
    sanitizeRecord,
} from './extractors.js';

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        mode = 'AUTO_DETECT',
        targetUrls = [],
        searchKeywords = [],
        maxItems = 50,
        extractVideos = true,
        proxyConfiguration,
    } = input;

    const safeMaxItems = Math.max(1, Math.min(5000, Number(maxItems) || 50));

    log.info('🚀 Starting Pinterest Ultimate Scraper...', {
        mode,
        targetUrlsCount: targetUrls.length,
        searchKeywordsCount: searchKeywords.length,
        maxItems: safeMaxItems,
    });

    let proxyConfig;
    if (proxyConfiguration) {
        try {
            proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
        } catch (proxyErr) {
            log.warning(`⚠️ Proxy configuration skipped (${proxyErr.message}). Falling back to direct connection.`);
        }
    }

    const urlsToProcess = Array.isArray(targetUrls) ? targetUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];
    const keywordsToProcess = Array.isArray(searchKeywords) ? searchKeywords.map((k) => String(k || '').trim()).filter(Boolean) : [];

    if (urlsToProcess.length === 0 && keywordsToProcess.length === 0) {
        if (mode === 'SEARCH') {
            keywordsToProcess.push('minimalist home decor');
            log.info('ℹ️ No keywords provided for SEARCH. Defaulting to sample keyword.', { keywords: keywordsToProcess });
        } else {
            urlsToProcess.push(
                'https://www.pinterest.com/pin/861594972476596163/',
                'https://www.pinterest.com/nike/'
            );
            log.info('ℹ️ No inputs provided. Defaulting to sample Pinterest targets.', { urls: urlsToProcess });
        }
    }

    const sessionCookies = new Map();

    function captureCookies(headers) {
        const setCookie = headers?.['set-cookie'];
        if (!setCookie) return;
        const list = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const item of list) {
            const pair = String(item).split(';')[0];
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
                const name = pair.slice(0, eqIdx).trim();
                const value = pair.slice(eqIdx + 1).trim();
                if (name) sessionCookies.set(name, value);
            }
        }
    }

    function getCookieHeader() {
        return Array.from(sessionCookies.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    function buildHtmlHeaders() {
        const headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Upgrade-Insecure-Requests': '1',
        };
        const cookieStr = getCookieHeader();
        if (cookieStr) headers.Cookie = cookieStr;
        return headers;
    }

    async function fetchHtml(url) {
        const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
        const response = await gotScraping({
            url,
            headers: buildHtmlHeaders(),
            headerGeneratorOptions: {
                browsers: ['chrome'],
                operatingSystems: ['windows', 'macos', 'linux'],
                locales: ['en-US'],
            },
            proxyUrl,
            timeout: { request: 25000 },
            retry: { limit: 2 },
            throwHttpErrors: true,
        });
        captureCookies(response.headers);
        return {
            html: response.body,
            statusCode: response.statusCode || 200,
        };
    }

    async function ensureSession(seedUrl = 'https://www.pinterest.com/ideas/') {
        if (sessionCookies.has('csrftoken')) return sessionCookies.get('csrftoken');
        try {
            await fetchHtml(seedUrl);
        } catch (err) {
            log.debug(`Session seed fetch failed for ${seedUrl}: ${err.message}`);
        }
        return sessionCookies.get('csrftoken') || '';
    }

    async function fetchResourceJson(resourceName, sourceUrl, handler, options) {
        const csrfToken = await ensureSession(`https://www.pinterest.com${sourceUrl}`);
        const params = new URLSearchParams({
            source_url: sourceUrl,
            data: JSON.stringify({ options, context: {} }),
        });
        const endpoint = `https://www.pinterest.com/resource/${resourceName}/get/?${params.toString()}`;
        const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;

        const response = await gotScraping({
            url: endpoint,
            proxyUrl,
            headerGeneratorOptions: {
                browsers: ['chrome'],
                operatingSystems: ['windows', 'macos', 'linux'],
                locales: ['en-US'],
            },
            headers: {
                'Accept': 'application/json, text/javascript, */*, q=0.01',
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrfToken,
                'X-Pinterest-AppState': 'active',
                'X-Pinterest-Source-Url': sourceUrl,
                'X-Pinterest-PWS-Handler': handler,
                'Referer': `https://www.pinterest.com${sourceUrl}`,
                'Cookie': getCookieHeader(),
            },
            timeout: { request: 25000 },
            retry: { limit: 2 },
            throwHttpErrors: true,
        });
        captureCookies(response.headers);
        return JSON.parse(response.body);
    }

    async function fetchWithPlaywright(url) {
        let content = '';
        let statusCode = 200;
        const queueName = `pin-pw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const requestQueue = await RequestQueue.open(queueName);

        try {
            const crawler = new PlaywrightCrawler({
                requestQueue,
                proxyConfiguration: proxyConfig,
                maxRequestsPerCrawl: 1,
                maxRequestRetries: 1,
                headless: true,
                requestHandlerTimeoutSecs: 40,
                preNavigationHooks: [
                    async (_ctx, gotoOptions) => {
                        gotoOptions.waitUntil = 'domcontentloaded';
                    },
                ],
                async requestHandler({ page, response }) {
                    statusCode = response ? response.status() : 200;
                    try {
                        const acceptBtn = page.locator('button:has-text("Accept"), button:has-text("Got it")').first();
                        if (await acceptBtn.isVisible({ timeout: 2000 })) {
                            await acceptBtn.click();
                        }
                    } catch {
                        // ignore banner absence
                    }
                    await page.waitForSelector('script#__PWS_INITIAL_PROPS__, script[type="application/ld+json"], [data-test-id="pin"]', { timeout: 6000 }).catch(() => {});
                    content = await page.content();
                },
            });
            await crawler.run([url]);
        } finally {
            await requestQueue.drop().catch(() => {});
        }
        return { html: content, statusCode };
    }

    async function fetchPageWithFallback(url) {
        try {
            const res = await fetchHtml(url);
            if (!isPinterestBlocked(res.html, res.statusCode)) {
                return res;
            }
            throw new Error(`HTTP ${res.statusCode} or challenge page`);
        } catch (fetchErr) {
            log.warning(`⚠️ HTTP fetch blocked/failed for ${url} (${fetchErr.message}). Fallback to Playwright...`);
            const pwRes = await fetchWithPlaywright(url);
            if (isPinterestBlocked(pwRes.html, pwRes.statusCode)) {
                throw new Error(`Blocked by Pinterest anti-bot (HTTP ${pwRes.statusCode})`);
            }
            return pwRes;
        }
    }

    function detectUrlMode(url, explicitMode) {
        const lower = url.toLowerCase();
        if (lower.includes('/pin/')) return 'PINS';
        if (lower.includes('/search/')) return 'SEARCH';

        const cleanPath = url.replace(/https?:\/\/(?:[a-z0-9-]+\.)?pinterest\.[a-z.]+\/?/i, '').split('?')[0].split('#')[0].replace(/\/+$/, '');
        const parts = cleanPath.split('/').filter(Boolean);
        const profileTabs = new Set(['_saved', '_created', 'pins', 'followers', 'following']);
        if (parts.length >= 2 && !profileTabs.has(parts[1].toLowerCase())) {
            return 'BOARDS';
        }
        if (parts.length >= 1) {
            return 'PROFILES';
        }
        if (explicitMode && explicitMode !== 'AUTO_DETECT') return explicitMode;
        return 'PINS';
    }

    const stats = {
        pins: 0,
        boards: 0,
        profiles: 0,
        searchResults: 0,
        failed: 0,
    };
    const diagnostics = [];

    function applyVideoPreference(pin) {
        if (!extractVideos && pin && pin.isVideo) {
            delete pin.videoUrl;
        }
        return sanitizeRecord(pin);
    }

    async function runSearchKeyword(keyword) {
        log.info(`🔍 Searching Pinterest for keyword: "${keyword}"`);
        let collected = 0;
        let bookmark;
        const seenIds = new Set();
        const sourceUrl = `/search/pins/?q=${encodeURIComponent(keyword)}&rs=typed`;

        while (collected < safeMaxItems) {
            try {
                const options = {
                    query: keyword,
                    scope: 'pins',
                    rs: 'typed',
                    page_size: 25,
                };
                if (bookmark) options.bookmarks = [bookmark];

                const json = await fetchResourceJson('BaseSearchResource', sourceUrl, 'www/search/[scope].js', options);
                const resp = json?.resource_response;
                const results = Array.isArray(resp?.data?.results) ? resp.data.results : [];
                if (results.length === 0) break;

                let addedThisPage = 0;
                for (const item of results) {
                    if (collected >= safeMaxItems) break;
                    if (!item || item.is_promoted || !item.id) continue;
                    const parsed = parsePinData(item);
                    if (!parsed || seenIds.has(parsed.id)) continue;
                    seenIds.add(parsed.id);

                    const record = applyVideoPreference({
                        ...parsed,
                        searchQuery: keyword,
                    });
                    await Actor.pushData(record);
                    collected++;
                    addedThisPage++;
                    stats.searchResults++;
                }

                const nextBookmark = resp?.bookmark;
                if (!nextBookmark || nextBookmark === '-end-' || nextBookmark === bookmark || addedThisPage === 0) {
                    break;
                }
                bookmark = nextBookmark;
            } catch (err) {
                if (collected === 0) {
                    log.error(`❌ Search error for "${keyword}": ${err.message}`);
                    stats.failed++;
                    diagnostics.push(`Search "${keyword}": ${err.message}`);
                } else {
                    log.warning(`⚠️ Search pagination stopped early for "${keyword}": ${err.message}`);
                }
                break;
            }
        }

        log.info(`✅ Found and scraped ${collected} pins for keyword: "${keyword}"`);
    }

    // 1. PROCESS TARGET URLS
    for (const url of urlsToProcess) {
        const currentMode = detectUrlMode(url, mode);
        log.info(`🎯 Processing [${currentMode}]: ${url}`);

        try {
            if (currentMode === 'SEARCH') {
                let query = '';
                try {
                    query = new URL(url).searchParams.get('q') || '';
                } catch {
                    // ignore invalid URL
                }
                if (!query) throw new Error('Search URL missing ?q= parameter');
                await runSearchKeyword(query);
                continue;
            }

            if (currentMode === 'PINS') {
                let pin = null;
                const pinIdMatch = url.match(/\/pin\/(?:[^/]*?-)?(\d+)/i);
                const pinId = pinIdMatch ? pinIdMatch[1] : null;

                // Try official PinResource JSON first for full metadata (saves, outbound link, board, video)
                if (pinId) {
                    try {
                        const pinJson = await fetchResourceJson(
                            'PinResource',
                            `/pin/${pinId}/`,
                            'www/pin/[id].js',
                            { id: pinId, field_set_key: 'unauth_react_main_pin' }
                        );
                        const pinObj = pinJson?.resource_response?.data;
                        if (pinObj?.id) {
                            pin = parsePinData(pinObj);
                        }
                    } catch (resErr) {
                        log.debug(`PinResource fallback needed for ${pinId}: ${resErr.message}`);
                    }
                }

                // Fallback to SSR HTML / SocialMediaPosting JSON-LD
                if (!pin) {
                    const { html } = await fetchPageWithFallback(url);
                    const pwsData = extractPwsData(html);
                    const redux = getReduxState(pwsData);
                    if (redux?.pins && Object.keys(redux.pins).length > 0) {
                        const pinObj = (pinId && redux.pins[pinId]) || Object.values(redux.pins)[0];
                        if (pinObj) pin = parsePinData(pinObj);
                    }
                    if (!pin) {
                        pin = parsePinHtmlFallback(html, url);
                    }
                }

                if (!pin) throw new Error('Could not parse Pin data from API or HTML');
                await Actor.pushData(applyVideoPreference(pin));
                stats.pins++;
                log.info(`✅ Successfully scraped Pin: "${pin.title || pin.id}" [Outbound: ${pin.domain || 'None'}, Saves: ${pin.saveCount ?? 0}]`);
            } else if (currentMode === 'BOARDS') {
                const { html } = await fetchPageWithFallback(url);
                const pwsData = extractPwsData(html);
                const redux = getReduxState(pwsData);

                const board = parseBoardData(html, url, pwsData);
                if (!board) throw new Error('Could not parse Board metadata');

                await Actor.pushData(board);
                stats.boards++;
                log.info(`✅ Successfully scraped Board: "${board.title}" [Pins: ${board.boardPinsCount ?? 0}]`);

                const seenPinIds = new Set();
                let extractedPins = 0;

                const ssrPins = Object.values(redux?.pins || {});
                for (const pinObj of ssrPins) {
                    if (extractedPins >= safeMaxItems) break;
                    const p = parsePinData(pinObj);
                    if (p && !seenPinIds.has(p.id)) {
                        seenPinIds.add(p.id);
                        await Actor.pushData(applyVideoPreference({
                            ...p,
                            boardName: p.boardName || board.title,
                            boardUrl: p.boardUrl || board.url,
                        }));
                        extractedPins++;
                        stats.pins++;
                    }
                }

                // Paginate BoardFeedResource if more pins requested
                const boardPath = new URL(url).pathname;
                const boardFeedEntry = Object.values(redux?.resources?.BoardFeedResource || {})[0];
                let bookmark = boardFeedEntry?.nextBookmark;
                if (extractedPins < safeMaxItems && board.id && /^\d+$/.test(String(board.id))) {
                    while (extractedPins < safeMaxItems && bookmark !== '-end-') {
                        try {
                            const opts = { board_id: String(board.id), board_url: boardPath, page_size: 25 };
                            if (bookmark) opts.bookmarks = [bookmark];
                            const bfJson = await fetchResourceJson('BoardFeedResource', boardPath, 'www/[username]/[slug].js', opts);
                            const dataArr = Array.isArray(bfJson?.resource_response?.data) ? bfJson.resource_response.data : [];
                            if (dataArr.length === 0) break;

                            let added = 0;
                            for (const pinObj of dataArr) {
                                if (extractedPins >= safeMaxItems) break;
                                const p = parsePinData(pinObj);
                                if (p && !seenPinIds.has(p.id)) {
                                    seenPinIds.add(p.id);
                                    await Actor.pushData(applyVideoPreference({
                                        ...p,
                                        boardName: p.boardName || board.title,
                                        boardUrl: p.boardUrl || board.url,
                                    }));
                                    extractedPins++;
                                    added++;
                                    stats.pins++;
                                }
                            }
                            const nextBm = bfJson?.resource_response?.bookmark;
                            if (!nextBm || nextBm === '-end-' || nextBm === bookmark || added === 0) break;
                            bookmark = nextBm;
                        } catch (pageErr) {
                            log.debug(`BoardFeedResource pagination ended: ${pageErr.message}`);
                            break;
                        }
                    }
                }

                log.info(`📌 Extracted ${extractedPins} pins from board: ${board.title}`);
            } else if (currentMode === 'PROFILES') {
                const { html } = await fetchPageWithFallback(url);
                const pwsData = extractPwsData(html);
                const redux = getReduxState(pwsData);

                const profile = parseProfileData(html, url, pwsData);
                if (!profile) throw new Error('Could not parse Creator Profile metadata');

                await Actor.pushData(profile);
                stats.profiles++;
                log.info(`✅ Successfully scraped Creator: "${profile.authorName}" [Followers: ${profile.authorFollowers ?? 'N/A'}]`);

                const seenPinIds = new Set();
                let extractedPins = 0;

                const ssrPins = Object.values(redux?.pins || {});
                for (const pinObj of ssrPins) {
                    if (extractedPins >= safeMaxItems) break;
                    const p = parsePinData(pinObj);
                    if (p && !seenPinIds.has(p.id)) {
                        seenPinIds.add(p.id);
                        await Actor.pushData(applyVideoPreference({
                            ...p,
                            author: p.author || profile.author,
                            authorName: p.authorName || profile.authorName,
                            authorUrl: p.authorUrl || profile.url,
                        }));
                        extractedPins++;
                        stats.pins++;
                    }
                }

                // Paginate UserPinsResource if more pins requested
                const userPinsEntry = Object.values(redux?.resources?.UserPinsResource || {})[0];
                let bookmark = userPinsEntry?.nextBookmark;
                if (extractedPins < safeMaxItems && profile.id) {
                    while (extractedPins < safeMaxItems && bookmark !== '-end-') {
                        try {
                            const opts = { username: profile.id, page_size: 25 };
                            if (bookmark) opts.bookmarks = [bookmark];
                            const upJson = await fetchResourceJson('UserPinsResource', `/${profile.id}/`, 'www/[username].js', opts);
                            const dataArr = Array.isArray(upJson?.resource_response?.data) ? upJson.resource_response.data : [];
                            if (dataArr.length === 0) break;

                            let added = 0;
                            for (const pinObj of dataArr) {
                                if (extractedPins >= safeMaxItems) break;
                                const p = parsePinData(pinObj);
                                if (p && !seenPinIds.has(p.id)) {
                                    seenPinIds.add(p.id);
                                    await Actor.pushData(applyVideoPreference({
                                        ...p,
                                        author: p.author || profile.author,
                                        authorName: p.authorName || profile.authorName,
                                        authorUrl: p.authorUrl || profile.url,
                                    }));
                                    extractedPins++;
                                    added++;
                                    stats.pins++;
                                }
                            }
                            const nextBm = upJson?.resource_response?.bookmark;
                            if (!nextBm || nextBm === '-end-' || nextBm === bookmark || added === 0) break;
                            bookmark = nextBm;
                        } catch (pageErr) {
                            log.debug(`UserPinsResource pagination ended: ${pageErr.message}`);
                            break;
                        }
                    }
                }

                log.info(`📌 Extracted ${extractedPins} recent pins from creator profile.`);
            }
        } catch (err) {
            log.error(`❌ Error scraping ${url}: ${err.message}`);
            stats.failed++;
            diagnostics.push(`${url}: ${err.message}`);
        }
    }

    // 2. PROCESS SEARCH KEYWORDS
    for (const keyword of keywordsToProcess) {
        await runSearchKeyword(keyword);
    }

    const totalRecordsExtracted = stats.pins + stats.boards + stats.profiles + stats.searchResults;
    const summary = {
        status: totalRecordsExtracted > 0 ? 'COMPLETED' : 'FAILED',
        timestamp: new Date().toISOString(),
        metrics: stats,
        totalRecordsExtracted,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        message: totalRecordsExtracted > 0
            ? 'Pinterest Ultimate Scraper completed successfully.'
            : 'Pinterest Ultimate Scraper extracted 0 records.',
    };

    await Actor.setValue('OUTPUT', summary);
    log.info('🏁 Execution Finished. Executive Summary:', summary);

    if (totalRecordsExtracted === 0) {
        const reason = diagnostics.length > 0 ? diagnostics.join('; ') : 'No valid Pinterest pins, boards, profiles, or search results matched.';
        await Actor.fail(`Extracted 0 Pinterest records. ${reason}`);
    }
} catch (fatalErr) {
    log.exception(fatalErr, '💥 Fatal error in Pinterest Ultimate Scraper');
    await Actor.fail(fatalErr.message);
} finally {
    await Actor.exit();
}
