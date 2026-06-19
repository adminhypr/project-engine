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

  it('linkifies bare domain google.com', () => {
    const { getByText } = render(
      <RichContentRenderer content="visit google.com today" mentions={[]} />
    )
    const link = getByText('google.com')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://google.com')
  })

  it('linkifies www.example.com (prepends https)', () => {
    const { getByText } = render(
      <RichContentRenderer content="see www.example.com" mentions={[]} />
    )
    const link = getByText('www.example.com')
    expect(link.getAttribute('href')).toBe('https://www.example.com')
  })

  it('linkifies bare domain with path: github.com/user/repo', () => {
    const { getByText } = render(
      <RichContentRenderer content="check github.com/anthropics/claude-code" mentions={[]} />
    )
    const link = getByText('github.com/anthropics/claude-code')
    expect(link.getAttribute('href')).toBe('https://github.com/anthropics/claude-code')
  })

  it('linkifies case-insensitive: Google.com', () => {
    const { getByText } = render(
      <RichContentRenderer content="Go to Google.com" mentions={[]} />
    )
    const link = getByText('Google.com')
    expect(link.getAttribute('href')).toMatch(/https:\/\/Google\.com/i)
  })

  it('does NOT linkify version numbers like v1.2.3', () => {
    const { container } = render(
      <RichContentRenderer content="install v1.2.3" mentions={[]} />
    )
    const links = container.querySelectorAll('a')
    expect(links.length).toBe(0)
  })

  it('does NOT linkify filenames like report.txt', () => {
    const { container } = render(
      <RichContentRenderer content="see report.txt attached" mentions={[]} />
    )
    const links = container.querySelectorAll('a')
    expect(links.length).toBe(0)
  })

  it('strips trailing comma from bare domain', () => {
    const { getByText } = render(
      <RichContentRenderer content="visit google.com, it's good" mentions={[]} />
    )
    const link = getByText('google.com')
    expect(link.getAttribute('href')).toBe('https://google.com')
  })
})

describe('RichContentRenderer markdown — inline', () => {
  it('renders ~~strikethrough~~ as <s>', () => {
    const { container } = render(
      <RichContentRenderer content="this is ~~gone~~ now" mentions={[]} />
    )
    expect(container.querySelector('s')?.textContent).toBe('gone')
  })

  it('renders `inline code` as <code>', () => {
    const { container } = render(
      <RichContentRenderer content="run `npm test` please" mentions={[]} />
    )
    expect(container.querySelector('code')?.textContent).toBe('npm test')
  })

  it('keeps markdown inside inline code literal (no nested <strong>)', () => {
    const { container } = render(
      <RichContentRenderer content="`**not bold**`" mentions={[]} />
    )
    const code = container.querySelector('code')
    expect(code?.textContent).toBe('**not bold**')
    expect(code.querySelector('strong')).toBeNull()
  })

  it('composes strike/code with bold and italic', () => {
    const { container } = render(
      <RichContentRenderer content="**b** _i_ ~~s~~ `c`" mentions={[]} />
    )
    expect(container.querySelector('strong')?.textContent).toBe('b')
    expect(container.querySelector('em')?.textContent).toBe('i')
    expect(container.querySelector('s')?.textContent).toBe('s')
    expect(container.querySelector('code')?.textContent).toBe('c')
  })

  it('does NOT treat a lone ~ as strikethrough', () => {
    const { container } = render(
      <RichContentRenderer content="about ~5 minutes" mentions={[]} />
    )
    expect(container.querySelector('s')).toBeNull()
  })

  it('does NOT treat a single backtick in prose as code', () => {
    const { container } = render(
      <RichContentRenderer content="press the ` key" mentions={[]} />
    )
    expect(container.querySelector('code')).toBeNull()
  })
})

describe('RichContentRenderer markdown — blocks', () => {
  it('renders a fenced code block as <pre><code> with literal content', () => {
    const { container } = render(
      <RichContentRenderer content={'```\nconst x = **1**\n```'} mentions={[]} />
    )
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre.querySelector('code')?.textContent).toBe('const x = **1**')
    expect(pre.querySelector('strong')).toBeNull()
  })

  it('renders multi-line fenced code preserving newlines', () => {
    const { container } = render(
      <RichContentRenderer content={'```\nline1\nline2\n```'} mentions={[]} />
    )
    expect(container.querySelector('pre code')?.textContent).toBe('line1\nline2')
  })

  it('renders consecutive "> " lines as one blockquote', () => {
    const { container } = render(
      <RichContentRenderer content={'> first\n> second'} mentions={[]} />
    )
    const bq = container.querySelectorAll('blockquote')
    expect(bq).toHaveLength(1)
    expect(bq[0].textContent).toContain('first')
    expect(bq[0].textContent).toContain('second')
  })

  it('does NOT treat a mid-line > as a blockquote', () => {
    const { container } = render(
      <RichContentRenderer content="two > three" mentions={[]} />
    )
    expect(container.querySelector('blockquote')).toBeNull()
  })

  it('renders "- " lines as a <ul> with <li> items', () => {
    const { container } = render(
      <RichContentRenderer content={'- apple\n- banana'} mentions={[]} />
    )
    const ul = container.querySelector('ul')
    expect(ul).not.toBeNull()
    expect(ul.querySelectorAll('li')).toHaveLength(2)
    expect(ul.querySelectorAll('li')[0].textContent).toContain('apple')
  })

  it('renders "1. " lines as an <ol> with <li> items', () => {
    const { container } = render(
      <RichContentRenderer content={'1. first\n2. second'} mentions={[]} />
    )
    const ol = container.querySelector('ol')
    expect(ol).not.toBeNull()
    expect(ol.querySelectorAll('li')).toHaveLength(2)
  })

  it('still applies inline markdown inside list items', () => {
    const { container } = render(
      <RichContentRenderer content={'- **bold** item'} mentions={[]} />
    )
    expect(container.querySelector('li strong')?.textContent).toBe('bold')
  })

  it('does NOT turn a hyphenated word into a list', () => {
    const { container } = render(
      <RichContentRenderer content="well-known fact" mentions={[]} />
    )
    expect(container.querySelector('ul')).toBeNull()
  })

  it('still renders @mentions in the plaintext path', () => {
    const { container } = render(
      <RichContentRenderer
        content="hey @Jane how are you"
        mentions={[{ user_id: '1', display_name: 'Jane' }]}
      />
    )
    expect(container.textContent).toContain('@Jane')
  })
})
