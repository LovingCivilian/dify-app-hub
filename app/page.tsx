import { redirect } from 'next/navigation'

// Spec §7.6: a server redirect replaces the client spinner. Signed out, the proxy already sends `/` to
// /login?callbackUrl=%2F; redirect() throws, so nothing may wrap it in try/catch (Next redirect reference).
export default function Home() {
	redirect('/apps')
}
