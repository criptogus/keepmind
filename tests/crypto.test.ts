import { it, expect } from 'vitest'
import { createCryptoHeader, deriveKey, encryptMemory, decryptMemory } from '../src/main/services/sync-crypto'
it('roundtrips unicode with random nonces and rejects wrong keys and tampering', async () => {
  const header = await createCryptoHeader()
  const key = await deriveKey('correct horse battery staple', header)
  const wrong = await deriveKey('different passphrase', header)
  const encrypted = await encryptMemory('Private memory 🧠\n秘密', key)
  expect(encrypted).not.toContain('Private memory')
  expect(await encryptMemory('Private memory 🧠\n秘密', key)).not.toBe(encrypted)
  expect(await decryptMemory(encrypted, key)).toBe('Private memory 🧠\n秘密')
  await expect(decryptMemory(encrypted, wrong)).rejects.toThrow(/authentication failed/)
  const [prefix, body] = encrypted.split('\n')
  const data = JSON.parse(body)
  data.box = (data.box[0] === 'A' ? 'B' : 'A') + data.box.slice(1)
  await expect(decryptMemory(prefix + '\n' + JSON.stringify(data), key)).rejects.toThrow()
  await expect(decryptMemory('plaintext', key)).rejects.toThrow(/downgrade/)
  key.fill(0); wrong.fill(0)
})
