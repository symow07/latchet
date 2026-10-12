// The parts of mailparser's API this library uses (the package ships no types).
declare module "mailparser" {
  export interface EmailAddress {
    address?: string;
    name?: string;
    group?: EmailAddress[];
  }
  export interface AddressObject {
    value: EmailAddress[];
    text: string;
  }
  export interface Attachment {
    contentType: string;
    filename?: string;
    content: Buffer;
    size: number;
    related?: boolean;
    contentDisposition?: string;
  }
  export interface HeaderLine {
    key: string;
    line: string;
  }
  export interface ParsedMail {
    subject?: string;
    from?: AddressObject;
    date?: Date;
    messageId?: string;
    text?: string;
    html?: string | false;
    attachments: Attachment[];
    headerLines: HeaderLine[];
  }
  export interface SimpleParserOptions {
    skipHtmlToText?: boolean;
    skipTextToHtml?: boolean;
    skipTextLinks?: boolean;
    skipImageLinks?: boolean;
    keepCidLinks?: boolean;
    maxHtmlLengthToParse?: number;
  }
  export function simpleParser(source: Buffer | string, options?: SimpleParserOptions): Promise<ParsedMail>;
}
