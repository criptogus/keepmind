declare module 'qrcode' {
  export function toDataURL(text: string, opts?: any): Promise<string>
  export function toString(text: string, opts?: any): Promise<string>
  const QRCode: any
  export default QRCode
}
