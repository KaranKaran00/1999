# UPI QR Code Generator

# live https://karankaran00.github.io/1999/

A single-file, client-side tool that turns one payment amount into as many UPI QR
codes as needed, capped at ₹1,999 each.

## Running it

Open `index.html` in any modern browser. That's the whole install.

There is no build step, no server, no `npm install`. If you want to serve it
locally anyway:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

To put it on the web, drop `index.html` on any static host — GitHub Pages,
Netlify, Vercel, Cloudflare Pages, or the `htdocs` folder of an XAMPP install.

## What it does

- Splits any amount into the **minimum** number of QR codes, none above ₹1,999
  (₹5,000 → ₹1,999 + ₹1,999 + ₹1,002)
- Shows the split live as you type, before you generate anything
- Builds a standard UPI URI per code:
  `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…`
- Downloads one QR as a PNG, all of them as a print-ready A4 PDF, or all of
  them as a ZIP of PNGs
- Copies the raw `upi://` link for any single payment
- Prints with the form and toolbar hidden, two stubs per row
- Validates the UPI ID format, the account name and the amount inline

## How the money is handled

Every amount is stored as an **integer number of paise**, never a float. The
input is parsed with `Math.round(parseFloat(value) * 100)` and only converted
back to rupees for display. This is why ₹1,999.50 and ₹0.99 split without any
rounding drift, and why the split parts always sum to exactly the original.

The split itself is a greedy loop, which for a fixed cap gives the provably
minimum count, `ceil(total / 1999)`:

```js
while (remaining > 0) {
  const chunk = Math.min(remaining, 199900); // paise
  parts.push(chunk);
  remaining -= chunk;
}
```

## QR quality

Codes are drawn module-by-module onto a `<canvas>` rather than scaled up from a
small bitmap, at error-correction level M with a 4-module quiet zone. Screen
rendering uses ~720px, PNG export ~860px, PDF ~900px at 72mm. Nothing is ever
stretched, so the modules stay square and scannable after printing.

## Privacy

Everything runs in the browser tab. The UPI ID, account name, amount and note
are never transmitted, and nothing is written to `localStorage`,
`sessionStorage`, cookies or any analytics. Close the tab and the data is gone.

The only network requests are the three CDN libraries and the webfont, all made
before you type anything.

## Dependencies (loaded from cdnjs)

| Library | Version | Used for |
|---|---|---|
| qrcode-generator | 1.4.4 | QR matrix generation |
| jsPDF | 2.5.1 | A4 PDF export |
| JSZip | 3.10.1 | ZIP export |
| Inter (Google Fonts) | — | Typeface |

To make the tool work fully offline, download those four and swap the CDN
`<script>`/`<link>` tags for local paths.

## Known limitation

jsPDF's built-in Helvetica has no ₹ glyph, so the PDF writes amounts as
`INR 1,999`. The on-screen view and the PNG exports use ₹ correctly. Embedding a
rupee-capable font in jsPDF would fix it at the cost of a few hundred KB.

## Code map

Everything lives in `index.html`:

- **CSS layer 1** — primitives (raw colour, spacing and radius scales)
- **CSS layer 2** — semantic tokens (`--fg-primary`, `--bg-brand`), with the
  dark-mode swap happening only here
- **CSS layer 3** — component tokens (`--control-h`, `--field-bg`)
- **JS** — one IIFE, grouped as: money formatting → splitting → QR rendering →
  saving → validation → live preview → card rendering → PDF → ZIP → wiring

Because dark mode is a single swap at layer 2, no component rule contains a raw
hex value; rebranding the tool means editing the semantic block only.

## Adjusting the cap

The ₹1,999 ceiling is one constant near the top of the script:

```js
var MAX_PAISE = 199900;  // ₹1,999.00 per QR
var MAX_QRS   = 200;     // refuses totals needing more codes than this
```
