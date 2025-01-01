import type { CommunityLexiconBookmarksBookmark } from '@lexicon-community/types'
import { html } from '../lib/view'
import { shell } from './shell'

const TODAY = new Date().toDateString()

const STATUS_OPTIONS = [
  '👍',
  '👎',
  '💙',
  '🥹',
  '😧',
  '😤',
  '🙃',
  '😉',
  '😎',
  '🤓',
  '🤨',
  '🥳',
  '😭',
  '😤',
  '🤯',
  '🫡',
  '💀',
  '✊',
  '🤘',
  '👀',
  '🧠',
  '👩‍💻',
  '🧑‍💻',
  '🥷',
  '🧌',
  '🦋',
  '🚀',
]

type Props = {
  bookmarks: CommunityLexiconBookmarksBookmark.Record[]
  profile?: { displayName?: string }
}

export function home(props: Props) {
  return shell({
    title: 'Home',
    content: content(props),
  })
}

function content({ bookmarks, profile }: Props) {
  return html`<div id="root">
    <div class="error"></div>
    <div id="header">
      <h1>Bookmarkphere</h1>
      <p>Set your Bookmark on the Atmosphere.</p>
    </div>
    <div class="container">
      <div class="card">
        ${profile
          ? html`<form action="/logout" method="post" class="session-form">
              <div>
                Hi, <strong>${profile.displayName || 'friend'}</strong>. What's
                your status today?
              </div>
              <div>
                <button type="submit">Log out</button>
              </div>
            </form>`
          : html`<div class="session-form">
              <div><a href="/login">Log in</a> to set your status!</div>
              <div>
                <a href="/login" class="button">Log in</a>
              </div>
            </div>`}
      </div>
      <form action="/status" method="post" class="status-options">
        <button>
          <span>Make bookmark?</span>
        </button>
      </form>
      ${bookmarks.map((bookmark, i) => {
        const date = ts(bookmark)
        return html`
          <div class=${i === 0 ? 'status-line no-line' : 'status-line'}>
            <div>
              <div class="bookmark">${bookmark.subject}</div>
            </div>
            <div class="desc">
            ${`you bookmarked ${bookmark.subject} on ${date}`}
            </div>
          </div>
        `
      })}
    </div>
  </div>`
}

function toBskyLink(did: string) {
  return `https://bsky.app/profile/${did}`
}

function ts(bookmark: CommunityLexiconBookmarksBookmark.Record) {
  const createdAt = new Date(bookmark.createdAt)
  createdAt.toDateString()
}
