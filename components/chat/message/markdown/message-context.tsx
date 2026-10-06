'use client'

import { createContext, useContext } from 'react'

/** The Dify message id a Markdown tree belongs to (think timers are stored per message). */
export const MarkdownMessageContext = createContext<string | undefined>(undefined)

export const useMarkdownMessageId = () => useContext(MarkdownMessageContext)
