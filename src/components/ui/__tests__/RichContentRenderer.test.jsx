import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RichContentRenderer from '../RichContentRenderer'

describe('RichContentRenderer URL auto-linking', () => {
  it('renders bare https URL as a link', () => {
    const { getByText } = render(
      <RichContentRenderer content="check this out https://example.com it's cool" mentions={[]} />
    )
    const link = getByText('https://example.com')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })

  it('strips trailing punctuation from URL', () => {
    const { getByText } = render(
      <RichContentRenderer content="go to https://example.com." mentions={[]} />
    )
    const link = getByText('https://example.com')
    expect(link.getAttribute('href')).toBe('https://example.com')
  })

  it('does NOT double-linkify a URL already inside [text](url) markdown', () => {
    const { getByText } = render(
      <RichContentRenderer content="see [the docs](https://docs.example.com)" mentions={[]} />
    )
    const link = getByText('the docs')
    expect(link.getAttribute('href')).toBe('https://docs.example.com')
  })

  it('handles multiple URLs in the same message', () => {
    const { container } = render(
      <RichContentRenderer content="see https://a.com and https://b.com" mentions={[]} />
    )
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe('https://a.com')
    expect(links[1].getAttribute('href')).toBe('https://b.com')
  })

  it('renders http:// URLs as links too', () => {
    const { getByText } = render(
      <RichContentRenderer content="legacy link http://example.org here" mentions={[]} />
    )
    const link = getByText('http://example.org')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('http://example.org')
  })

  it('preserves existing **bold** and _italic_ alongside URLs', () => {
    const { container, getByText } = render(
      <RichContentRenderer content="**hey** visit https://example.com _now_" mentions={[]} />
    )
    expect(container.querySelector('strong')?.textContent).toBe('hey')
    expect(container.querySelector('em')?.textContent).toBe('now')
    const link = getByText('https://example.com')
    expect(link.tagName).toBe('A')
  })
})
