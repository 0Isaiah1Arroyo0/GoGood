import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const makeHtml = (username: string | null) => `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Go Good username</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500&display=swap');
    body { margin:0; padding:0; width:100%!important; background-color:#EDEAE3; font-family:'DM Sans',Arial,sans-serif; }
    .wrapper { width:100%; background-color:#EDEAE3; padding:40px 0; }
    .card { max-width:480px; margin:0 auto; background-color:#FAF8F3; border-radius:24px; overflow:hidden; }
    .header { background-color:#0F7855; padding:40px 40px 36px; text-align:center; }
    .logo { font-family:'Fraunces',Georgia,serif; font-size:32px; font-weight:600; color:#FAF8F3; margin:0; letter-spacing:-0.5px; }
    .body { padding:40px 40px 32px; text-align:center; }
    .icon { font-size:40px; margin-bottom:16px; }
    h1 { font-family:'Fraunces',Georgia,serif; font-size:26px; font-weight:400; color:#0F7855; letter-spacing:-0.5px; line-height:1.25; margin:0 0 24px; }
    h1 em { font-style:italic; }
    .username-badge { display:inline-block; background-color:#E8F5F0; color:#0F7855; font-family:'Fraunces',Georgia,serif; font-size:24px; font-weight:600; padding:14px 36px; border-radius:999px; letter-spacing:-0.3px; margin-bottom:24px; }
    .body-text { font-size:15px; line-height:1.6; color:#6B6860; margin:0 0 28px; }
    .button-wrap { margin:0 auto; text-align:center; }
    .button { display:inline-block; background-color:#0F7855; color:#FAF8F3!important; font-family:'DM Sans',Arial,sans-serif; font-size:16px; font-weight:500; text-decoration:none; padding:16px 44px; border-radius:999px; }
    hr { height:1px; background-color:rgba(15,120,85,0.1); margin:32px auto 0; width:60px; border:none; }
    .fine-print { font-size:12px; line-height:1.6; color:#A8A49C; margin:24px 0 0; }
    .footer { padding:28px 40px 36px; text-align:center; background-color:#F2EFE6; }
    .footer-logo { font-family:'Fraunces',Georgia,serif; font-size:16px; font-weight:600; color:#0F7855; margin:0 0 6px; }
    .footer-tagline { font-family:'Fraunces',Georgia,serif; font-size:12px; font-style:italic; color:#A8A49C; margin:0 0 14px; }
    .footer-text { font-size:11px; line-height:1.6; color:#B5B1A8; margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <p class="logo">gogood</p>
      </div>
      <div class="body">
        <div class="icon">${username ? '🙋' : '🔍'}</div>
        ${username
          ? `<h1>Found it! Your<br><em>username is</em></h1>
             <div class="username-badge">@${username}</div>
             <p class="body-text">Use your email address and password to sign in — your username is what others see on your profile.</p>
             <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
               <tr>
                 <td align="center" style="border-radius:999px; background-color:#0F7855;">
                   <a href="gogood://auth/login" target="_blank" class="button" style="display:inline-block; background-color:#0F7855; color:#FAF8F3; font-family:'DM Sans',Arial,sans-serif; font-size:16px; font-weight:500; text-decoration:none; padding:16px 44px; border-radius:999px;">
                     go sign in →
                   </a>
                 </td>
               </tr>
             </table>`
          : `<h1>Hmm, we<br><em>couldn't find it.</em></h1>
             <p class="body-text">No username has been set for this account yet. Open the app, sign in with your email and password, then set your username in your profile.</p>
             <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
               <tr>
                 <td align="center" style="border-radius:999px; background-color:#0F7855;">
                   <a href="gogood://auth/login" target="_blank" class="button" style="display:inline-block; background-color:#0F7855; color:#FAF8F3; font-family:'DM Sans',Arial,sans-serif; font-size:16px; font-weight:500; text-decoration:none; padding:16px 44px; border-radius:999px;">
                     open go good →
                   </a>
                 </td>
               </tr>
             </table>`
        }
        <hr>
        <p class="fine-print">If you didn't request this, you can safely ignore this email.</p>
      </div>
      <div class="footer">
        <p class="footer-logo">gogood</p>
        <p class="footer-tagline">stop wasting. start saving.</p>
        <p class="footer-text">Go Good · North Carolina<br>You received this because a username lookup was requested for this address.</p>
      </div>
    </div>
  </div>
</body>
</html>`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') return json({ error: 'email required' }, 400)

    // Fire-and-forget so we never reveal whether an account exists
    const attemptSend = async () => {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )

      const { data: username } = await admin.rpc('get_username_by_email', { user_email: email.trim().toLowerCase() })

      // Only send if the email belongs to a real account
      if (username === undefined || username === null) {
        // Account not found — still send a polite "not found" email to avoid enumeration via timing
        // (comment out the return below to send the not-found variant instead)
        return
      }

      const resendKey = Deno.env.get('RESEND_API_KEY')
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? 'noreply@gogood.app'
      if (!resendKey) return

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Go Good <${fromEmail}>`,
          to: [email.trim().toLowerCase()],
          subject: 'Your Go Good username',
          html: makeHtml(username),
        }),
      })
    }

    attemptSend().catch(() => { /* non-fatal */ })

    // Always return 200 — never leak whether the email exists
    return json({ ok: true })
  } catch {
    return json({ error: 'internal server error' }, 500)
  }
})
