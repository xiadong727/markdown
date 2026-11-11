// 墨记 · AI 润色代理（Supabase Edge Function）
// 浏览器无法直连不开放 CORS 的 AI 服务商，这里用服务端转发绕开 CORS。
// 前端传入 baseUrl/model/apiKey/text/instruction，函数转发到 OpenAI 兼容的
// /chat/completions，再把结果回传。apiKey 仅用于本次转发，不落盘、不记录。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405)

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }

  const baseUrl = String(payload.baseUrl || '').trim()
  const model = String(payload.model || '').trim()
  const apiKey = String(payload.apiKey || '').trim()
  const text = String(payload.text || '')
  const instruction = String(payload.instruction || '').trim()

  if (!baseUrl || !model || !apiKey) return json({ error: 'AI 未配置（缺 baseUrl/model/apiKey）' }, 400)
  if (!text.trim() && !instruction) return json({ error: '原文和润色要求不能都为空' }, 400)

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const sys = '你是中文写作润色助手。请在不改变原意的前提下，让文字更通顺、准确、简洁。' +
    '只输出润色后的正文本身，不要加任何解释、前后缀或引号。'
  const user = (instruction ? ('要求：' + instruction + '\n\n') : '') +
    (text.trim() ? ('待润色文字：\n' + text) : '（没有给出原文，请根据上面的要求直接生成。）')

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        stream: false,
      }),
    })
  } catch (e) {
    return json({ error: '代理无法连接 AI 服务商：' + ((e as Error).message || String(e)) + '。请检查 baseUrl 是否正确。' }, 502)
  }

  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.error?.message || '' } catch { detail = await res.text().catch(() => '') }
    return json({ error: 'AI 请求失败 ' + res.status + (detail ? '：' + detail : '') }, res.status)
  }

  let out = ''
  try {
    const data = await res.json()
    out = data?.choices?.[0]?.message?.content || ''
  } catch {
    return json({ error: 'AI 返回解析失败' }, 502)
  }
  if (!out.trim()) return json({ error: 'AI 返回为空' }, 502)

  return json({ content: out.trim() })
})
