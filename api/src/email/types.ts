export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailProvider {
  readonly name: 'console' | 'resend' | 'file'
  send(message: EmailMessage): Promise<void>
}
