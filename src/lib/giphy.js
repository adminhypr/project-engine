// GIPHY REST helpers — Slack-style GIF picker.
//
// We roll our own thin client against the public GIPHY REST API rather than
// pulling in @giphy/react-components. The API key is CLIENT-SIDE by design
// (GIPHY issues public keys for browser use). Per GIPHY's ToS we:
//   - HOTLINK the GIPHY CDN url (we never rehost to our own bucket)
//   - keep all url query params intact (analytics / signing GIPHY relies on)
//   - show a "Powered by GIPHY" attribution mark in the picker
// Rating is pinned to `pg`.

const KEY = import.meta.env.VITE_GIPHY_API_KEY
export const giphyEnabled = !!KEY

const BASE = 'https://api.giphy.com/v1/gifs'

// Pure normalizer — maps a raw GIPHY result object into our compact shape.
// Exported for unit testing. Handles missing renditions gracefully: a result
// with no usable image renditions returns null (caller filters those out).
export function normalizeGif(raw) {
  if (!raw || !raw.id) return null
  const images = raw.images || {}
  const fixedWidth = images.fixed_width || {}
  // Preview shown in the picker grid + in-stream thumbnail.
  const previewUrl = fixedWidth.url || images.preview_gif?.url || images.original?.url
  // The actual GIF we persist + render at full size. Prefer the lighter
  // `downsized` rendition, then `downsized_medium`, then `original`.
  const sendUrl =
    images.downsized?.url ||
    images.downsized_medium?.url ||
    images.original?.url ||
    previewUrl
  if (!previewUrl || !sendUrl) return null
  const width = parseInt(fixedWidth.width, 10)
  const height = parseInt(fixedWidth.height, 10)
  return {
    id: raw.id,
    title: raw.title || 'GIF',
    previewUrl,
    sendUrl,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
  }
}

function normalizeList(data) {
  const gifs = (Array.isArray(data?.data) ? data.data : [])
    .map(normalizeGif)
    .filter(Boolean)
  const totalCount =
    data?.pagination?.total_count ?? data?.pagination?.count ?? gifs.length
  return { gifs, totalCount }
}

async function request(url) {
  if (!giphyEnabled) return { gifs: [], totalCount: 0 }
  let res
  try {
    res = await fetch(url)
  } catch {
    const err = new Error('Network error reaching GIPHY')
    err.code = 'network'
    throw err
  }
  if (res.status === 429) {
    const err = new Error('GIPHY rate limit reached')
    err.code = 'rate_limit'
    err.status = 429
    throw err
  }
  if (!res.ok) {
    const err = new Error(`GIPHY request failed (${res.status})`)
    err.code = 'http'
    err.status = res.status
    throw err
  }
  const data = await res.json()
  return normalizeList(data)
}

export async function searchGifs(query, { offset = 0, limit = 24 } = {}) {
  if (!giphyEnabled || !query || !query.trim()) return { gifs: [], totalCount: 0 }
  const params = new URLSearchParams({
    api_key: KEY,
    q: query.trim(),
    limit: String(limit),
    offset: String(offset),
    rating: 'pg',
    bundle: 'messaging_non_clips',
  })
  return request(`${BASE}/search?${params.toString()}`)
}

export async function trendingGifs({ offset = 0, limit = 24 } = {}) {
  if (!giphyEnabled) return { gifs: [], totalCount: 0 }
  const params = new URLSearchParams({
    api_key: KEY,
    limit: String(limit),
    offset: String(offset),
    rating: 'pg',
  })
  return request(`${BASE}/trending?${params.toString()}`)
}
