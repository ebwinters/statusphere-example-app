import assert from 'node:assert'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import { isValidHandle } from '@atproto/syntax'
import { TID } from '@atproto/common'
import { Agent } from '@atproto/api'
import express from 'express'
import { getIronSession } from 'iron-session'
import type { AppContext } from '#/index'
import { home } from '#/pages/home'
import { login } from '#/pages/login'
import { env } from '#/lib/env'
import { page } from '#/lib/view'
import { CommunityLexiconBookmarksGetActorBookmarks, CommunityLexiconBookmarksBookmark, AtpBaseClient } from '@lexicon-community/types'
import * as Profile from '#/lexicon/types/app/bsky/actor/profile'
import pino from 'pino'
import { Bookmark } from './db'
import { buildFetchHandler } from '@atproto/xrpc'

type Session = { did: string }

// Helper function for defining routes
const handler =
  (fn: express.Handler) =>
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    try {
      await fn(req, res, next)
    } catch (err) {
      next(err)
    }
  }

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  ctx: AppContext
) {
  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: env.COOKIE_SECRET,
  })
  if (!session.did) return null
  try {
    const oauthSession = await ctx.oauthClient.restore(session.did)
    return oauthSession ? new Agent(oauthSession) : null
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth restore failed')
    await session.destroy()
    return null
  }
}

async function getCommunitySessionAgent(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  ctx: AppContext
) {
  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: env.COOKIE_SECRET,
  })
  if (!session.did) return null
  try {
    const oauthSession = await ctx.oauthClient.restore(session.did)
    const f = buildFetchHandler(oauthSession)
    return new AtpBaseClient(f)
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth restore failed')
    await session.destroy()
    return null
  }
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router()

  // Static assets
  router.use('/public', express.static(path.join(__dirname, 'pages', 'public')))

  // OAuth metadata
  router.get(
    '/client-metadata.json',
    handler((_req, res) => {
      return res.json(ctx.oauthClient.clientMetadata)
    })
  )

  // OAuth callback to complete session creation
  router.get(
    '/oauth/callback',
    handler(async (req, res) => {
      const params = new URLSearchParams(req.originalUrl.split('?')[1])
      try {
        const { session } = await ctx.oauthClient.callback(params)
        const clientSession = await getIronSession<Session>(req, res, {
          cookieName: 'sid',
          password: env.COOKIE_SECRET,
        })
        assert(!clientSession.did, 'session already exists')
        clientSession.did = session.did
        await clientSession.save()
      } catch (err) {
        ctx.logger.error({ err }, 'oauth callback failed')
        return res.redirect('/?error')
      }
      return res.redirect('/')
    })
  )

  // Login page
  router.get(
    '/login',
    handler(async (_req, res) => {
      return res.type('html').send(page(login({})))
    })
  )

  // Login handler
  router.post(
    '/login',
    handler(async (req, res) => {
      // Validate
      const handle = req.body?.handle
      if (typeof handle !== 'string' || !isValidHandle(handle)) {
        return res.type('html').send(page(login({ error: 'invalid handle' })))
      }

      // Initiate the OAuth flow
      try {
        const url = await ctx.oauthClient.authorize(handle, {
          scope: 'atproto transition:generic',
        })
        return res.redirect(url.toString())
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed')
        return res.type('html').send(
          page(
            login({
              error:
                err instanceof OAuthResolverError
                  ? err.message
                  : "couldn't initiate login",
            })
          )
        )
      }
    })
  )

  // Logout handler
  router.post(
    '/logout',
    handler(async (req, res) => {
      const session = await getIronSession<Session>(req, res, {
        cookieName: 'sid',
        password: env.COOKIE_SECRET,
      })
      await session.destroy()
      return res.redirect('/')
    })
  )

  // Homepage
  router.get(
    '/',
    handler(async (req, res) => {
      const agent = await getSessionAgent(req, res, ctx)
      

      // Fetch data stored in our SQLite
      // const bookmarks = await ctx.db
      //   .selectFrom('bookmarks')
      //   .selectAll()
      //   .orderBy('indexedAt', 'desc')
      //   .limit(10)
      //   .execute()
      if (!agent) {
        // Serve the logged-out view
        return res.type('html').send(page(home({ bookmarks: [] })))
      }

      const logger = pino({ name: 'server start' })

      //test
      // const atpClient = await getCommunitySessionAgent(req, res, ctx)

      // const r = await atpClient!.community.lexicon.bookmarks.getActorBookmarks({
      //   limit: 10
      // });
      // r.data.bookmarks.forEach((bookmark) => {
      //   logger.info({bookmark: bookmark}, 'bookmark');
      // });

      const resp = await agent!.com.atproto.repo.listRecords({
        repo: agent!.did ?? '',
        collection: 'community.lexicon.bookmarks.bookmark',
        limit: 2
      });
      
      const bookmarks = resp.data.records
      .filter((record) => {
        const isValid = CommunityLexiconBookmarksBookmark.isRecord(record.value) &&
          CommunityLexiconBookmarksBookmark.validateRecord(record.value).success;
        if (!isValid) {
          logger.warn({ record: record }, 'Invalid record');
        }
        return isValid;
      })
      .map((record) => {
        logger.info({ record: record }, 'record');
        const recordVal = record.value as CommunityLexiconBookmarksBookmark.Record;
        return {
          subject: recordVal.subject,
          createdAt: recordVal.createdAt,
          tags: recordVal.tags,
          ...record, // Include any additional properties
        };
      });
      // agent.com.atproto.repo.deleteRecord({
      //   repo: agent.assertDid,
      //   collection: 'community.lexicon.bookmarks.bookmark',
      //   rkey: '3ldrdnt4eys2p',
      // })

      // Fetch additional information about the logged-in user
      const { data: profileRecord } = await agent.com.atproto.repo.getRecord({
        repo: agent.assertDid,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
      })
      const profile =
        Profile.isRecord(profileRecord.value) &&
        Profile.validateRecord(profileRecord.value).success
          ? profileRecord.value
          : {}

      // Serve the logged-in view
      return res.type('html').send(
        page(
          home({
            bookmarks,
            profile
          })
        )
      )
    })
  )

  // "Set status" handler
  router.post(
    '/status',
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res
          .status(401)
          .type('html')
          .send('<h1>Error: Session required</h1>')
      }


      // Construct & validate their status record
      const rkey = TID.nextStr()
      const record = {
        $type: 'community.lexicon.bookmarks.bookmark',
        subject: 'https://github.com/marketplace/models',
        createdAt: new Date().toISOString(),
      }
      if (!CommunityLexiconBookmarksBookmark.validateRecord(record).success) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Invalid bookmark</h1>')
      }

      let uri
      try {
        // Write the status record to the user's repository
        const res = await agent.com.atproto.repo.putRecord({
          repo: agent.assertDid,
          collection: 'community.lexicon.bookmarks.bookmark',
          rkey,
          record,
          validate: false,
        })
        uri = res.data.uri
      } catch (err) {
        ctx.logger.warn({ err }, 'failed to write record')
        return res
          .status(500)
          .type('html')
          .send('<h1>Error: Failed to write record</h1>')
      }

      try {
        // Optimistically update our SQLite
        // This isn't strictly necessary because the write event will be
        // handled in #/firehose/ingestor.ts, but it ensures that future reads
        // will be up-to-date after this method finishes.
        await ctx.db
          .insertInto('bookmarks')
          .values({
            subject: record.subject,
            createdAt: record.createdAt,
            indexedAt: new Date().toISOString(),
          })
          .execute()
      } catch (err) {
        ctx.logger.warn(
          { err },
          'failed to update computed view; ignoring as it should be caught by the firehose'
        )
      }

      return res.redirect('/')
    })
  )

  return router
}
