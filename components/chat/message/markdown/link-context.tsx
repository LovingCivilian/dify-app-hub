'use client'

import { createContext, useContext } from 'react'

/** How a link in an answer (an image or video `src`, a `<source>`, an anchor `href`) becomes the URL the browser loads. */
export type MarkdownLinkRewrite = (url: string | undefined) => string | undefined

const keepLink: MarkdownLinkRewrite = url => url

/**
 * The chat's link rewrite for the Markdown blocks (Part 2 spec §5.1: the Dify file-link rewrite was the one Dify
 * coupling in the renderer). The Dify chat provides one that sends Dify's file links through the app's remote-file
 * route (components/chat/dify-chat-contexts.ts); without a provider a link loads as written (react.dev
 * `createContext`: the default is "the value … when there is no matching context provider in the tree above").
 */
export const MarkdownLinkContext = createContext<MarkdownLinkRewrite>(keepLink)

export const useMarkdownLink = (): MarkdownLinkRewrite => useContext(MarkdownLinkContext)
