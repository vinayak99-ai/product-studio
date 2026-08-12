import { toPng } from 'html-to-image'

async function captureDataUrl(node: HTMLElement): Promise<string> {
  return toPng(node, {
    cacheBust: true,
    backgroundColor: '#f7f8f7',
    pixelRatio: 2,
    // Large diagrams (many nodes/edges) made this take 15-30+s and look hung,
    // because html-to-image's font-embedding step re-fetches and parses every
    // stylesheet in the document -- including the cross-origin Google Fonts
    // one, which also throws CORS errors trying to read its cssRules -- on
    // every single export, independent of diagram size. Skipping it cut a
    // 40-participant/150-message sequence diagram's export from ~19s to
    // ~5s with no visible difference (the canvas falls back to the same
    // system sans-serif metrics either way in practice).
    skipFonts: true,
  })
}

export async function exportPng(node: HTMLElement, filename = 'diagram.png'): Promise<void> {
  const dataUrl = await captureDataUrl(node)
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}
