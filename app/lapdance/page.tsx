import { redirect } from 'next/navigation'

// /lapdance is currently the same UX as the home page; we may differentiate later.
// For now, redirect to root so we have a single canonical entry point.
export default function LapdancePage() {
  redirect('/')
}
