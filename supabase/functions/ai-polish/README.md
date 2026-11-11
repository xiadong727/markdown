# AI 润色代理（Supabase Edge Function）

墨记是纯前端网页，浏览器无法直连不开放 CORS 的 AI 服务商（如
`maas-api.antdigital.com`），会报 `Failed to fetch`。这个 Edge Function
`ai-polish` 在服务端转发请求，绕开 CORS。

前端把 `baseUrl / model / apiKey / text / instruction` 传给代理，代理转发到
OpenAI 兼容的 `/chat/completions`，再回传润色结果。apiKey 仅本次转发使用，
不落盘、不记录。

## 部署步骤

需要 Supabase CLI（本机未安装，按需装）：

```bash
# 1. 安装 CLI（任选其一）
npm i -g supabase            # 或 brew install supabase/tap/supabase

# 2. 登录并关联项目
supabase login
supabase link --project-ref uriexaurqzndddnefzfk

# 3. 部署函数（项目根目录下执行）
supabase functions deploy ai-polish
```

部署后函数地址：

```
https://uriexaurqzndddnefzfk.supabase.co/functions/v1/ai-polish
```

前端已改为调用该地址，无需再改代码。

## 说明

- `verify_jwt = true`：前端请求头带 anon key（本身是合法 JWT），可通过校验。
- 若将来想把 apiKey 收到服务端（不经前端），可改用 Supabase Secret：
  `supabase secrets set AI_API_KEY=...`，并在函数里读 `Deno.env.get('AI_API_KEY')`。
