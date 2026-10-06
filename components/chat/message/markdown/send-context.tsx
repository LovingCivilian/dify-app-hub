'use client'

import { createContext, useContext } from 'react'

/** Lets Dify's <form data-format> and <button data-message> blocks post a message without inline component props. */
export const MarkdownSendContext = createContext<((text: string) => void) | undefined>(undefined)

export const useMarkdownSend = () => useContext(MarkdownSendContext)
