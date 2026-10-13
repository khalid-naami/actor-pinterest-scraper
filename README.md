# 📌 Pinterest Ultimate Scraper (Pins, Boards, HD Media, Outbound Links & Search)

High-speed, all-in-one Pinterest data extraction and trend discovery engine on Apify. Extract **Pins** with original HD images & MP4 videos, **Outbound Store Links** (Shopify, Etsy, Amazon, blogs), **Save/Repin Counts**, **Full Boards**, **Creator Profiles & Monthly Views**, and **Keyword Search** without requiring a login.

---

## ⚡ Key Features

- 🖼️ **Original HD Image Quality**: Automatically resolves and extracts the highest-resolution original image URLs (`originals/`, 1080p, 4K) — ideal for design inspiration and AI model training datasets (Midjourney, Stable Diffusion, Flux).
- 🔗 **Outbound Store & Destination Links**: Extracts the exact external URL where each pin leads (Shopify stores, Etsy listings, Amazon products, affiliate blogs) — the #1 feature for dropshipping & competitor research.
- 🎬 **Direct MP4 Video Downloads**: Extracts direct, high-quality MP4 video download streams for video pins and idea pins.
- 📈 **Engagement & Save Counts**: Scrapes repin / save counts, comments counts, and board categorization to identify viral trends.
- 📋 **Full Board Scraping**: Extract entire curated boards along with all pins inside each board.
- 👤 **Creator Profiles & Monthly Views**: Extract creator follower counts, monthly impressions/views, bio, avatar, and outbound website links.
- 🔍 **Keyword Search & Trend Discovery**: Search Pinterest by keyword queries to discover top-ranking pins, trending aesthetics, and Pinterest SEO insights.
- 🛡️ **Dual-Engine Architecture**: Blazing fast HTTP requests via `got-scraping` paired with an intelligent Playwright browser fallback.

---

## 📥 Input Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | String | `AUTO_DETECT` | Extraction mode: `AUTO_DETECT`, `PINS`, `BOARDS`, `PROFILES`, `SEARCH`. |
| `targetUrls` | Array | `[...]` | List of Pinterest URLs (Pin URLs `/pin/...`, Board URLs, or Profile URLs). |
| `searchKeywords` | Array | `[]` | Keywords to search across Pinterest for trend discovery. |
| `maxItems` | Integer | `50` | Maximum items to extract per target or search query. |
| `extractVideos` | Boolean | `true` | Automatically extract direct MP4 download links for video pins. |
| `proxyConfiguration` | Object | `{ useApifyProxy: true }` | Apify Residential proxy configuration (recommended). |

---

## 📤 Output Data Format

### 1. Pinterest Pin Record with Outbound Link & HD Media

```json
{
  "type": "PIN",
  "id": "861594972476596163",
  "url": "https://www.pinterest.com/pin/861594972476596163/",
  "title": "Minimalist Japanese Oak Coffee Table",
  "description": "Handcrafted solid white oak coffee table designed with clean lines and warm natural textures. Shop the collection now on Etsy.",
  "imageUrl": "https://i.pinimg.com/originals/ab/cd/ef/abcdef123456789.jpg",
  "images": {
    "original": "https://i.pinimg.com/originals/ab/cd/ef/abcdef123456789.jpg",
    "high": "https://i.pinimg.com/736x/ab/cd/ef/abcdef123456789.jpg",
    "medium": "https://i.pinimg.com/474x/ab/cd/ef/abcdef123456789.jpg",
    "thumbnail": "https://i.pinimg.com/236x/ab/cd/ef/abcdef123456789.jpg"
  },
  "isVideo": false,
  "outboundUrl": "https://www.etsy.com/listing/123456789/oak-coffee-table",
  "domain": "etsy.com",
  "saveCount": 4820,
  "commentsCount": 38,
  "author": "nordichome",
  "authorName": "Nordic Home Studio",
  "authorUrl": "https://www.pinterest.com/nordichome/",
  "boardName": "Living Room Furniture",
  "hashtags": [
    "coffeetable",
    "homedecor",
    "minimalism"
  ],
  "scrapedAt": "2026-10-09T22:15:00.000Z"
}
```

### 2. Creator Profile Record with Monthly Views

```json
{
  "type": "PROFILE",
  "id": "nike",
  "author": "nike",
  "authorName": "Nike",
  "url": "https://www.pinterest.com/nike/",
  "description": "Just Do It. Discover training tips, sport style, and workout inspiration.",
  "authorAvatarUrl": "https://i.pinimg.com/280x280_RS/...",
  "authorMonthlyViews": "10M+ monthly views",
  "authorFollowers": "1.2M followers",
  "scrapedAt": "2026-10-09T22:15:00.000Z"
}
```

---

## 💼 Dropshipping & Creative Use Cases

- **Winning Product Research**: Filter pins by high save counts (`> 1,000 saves`) and trace the outbound Shopify/Amazon links to validate product demand.
- **Affiliate & Competitor Spy**: Monitor top performing pins in your niche to see which affiliate offers and landing pages competitors are running.
- **AI Art & Creative Datasets**: Bulk download curated, uncompressed original images for training image generation models and creating moodboards.

---

## 📄 License
Apache-2.0
