const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const http2 = require('http2')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 8899

const DEFAULT_KEY_PATH = path.join(__dirname, '..', 'keys', 'AuthKey.p8')
const BUNDLE_IDS = {
  development: 'xyz.neosapien.neo2.dev',
  production:  'xyz.neosapien.neo1',
}

app.use(cors())
app.use(express.json())

function generateJwt(keyId, teamId, authKey) {
  return jwt.sign(
    { iss: teamId, iat: Math.floor(Date.now() / 1000) },
    authKey,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: keyId } }
  )
}

function sendApns(environment, token, payload, keyId, teamId, authKey) {
  return new Promise((resolve, reject) => {
    const host = environment === 'development'
      ? 'api.sandbox.push.apple.com'
      : 'api.push.apple.com'
    const bundleId = BUNDLE_IDS[environment] ?? BUNDLE_IDS.development
    const topic = `${bundleId}.push-type.liveactivity`
    const bearer = generateJwt(keyId, teamId, authKey)
    const body = JSON.stringify(payload)

    const client = http2.connect(`https://${host}`)
    client.on('error', reject)

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      'apns-topic': topic,
      'apns-push-type': 'liveactivity',
      'authorization': `bearer ${bearer}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    })

    let status, apnsHeaders, data = ''
    req.on('response', h => { status = h[':status']; apnsHeaders = h })
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      client.close()
      resolve({
        success: status === 200,
        status,
        apns_id: apnsHeaders?.['apns-id'] ?? '',
        error: status !== 200 ? data : null,
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

app.post('/api/send', async (req, res) => {
  const { environment, token, payload, key_id, team_id, auth_key } = req.body

  let authKey = auth_key
  if (!authKey) {
    if (fs.existsSync(DEFAULT_KEY_PATH)) {
      authKey = fs.readFileSync(DEFAULT_KEY_PATH, 'utf8')
    } else {
      return res.json({ success: false, status: 0, error: 'No auth key provided and no default key found' })
    }
  }

  try {
    const result = await sendApns(environment, token, payload, key_id, team_id, authKey)
    result.payload = payload
    result.sent_at = new Date().toISOString()
    res.json(result)
  } catch (e) {
    res.json({ success: false, status: 0, error: e.message, payload, sent_at: new Date().toISOString() })
  }
})

app.listen(PORT, () => {
  console.log(`\n  ⚡ Live Activity Server → http://localhost:${PORT}\n`)
})
