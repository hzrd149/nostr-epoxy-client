import { Proof } from "@cashu/cashu-ts";

export type PaymentRequest = {
  price: number;
  unit?: string;
  mint: string;
};
export type Payment = Proof[];

type NostrEvent = {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  sig: string;
  id: string;
  pubkey: string;
};

export type ProxyRequestMessage = ["PROXY", string] | ["PROXY", string, PaymentRequest | NostrEvent];

export type ProxyConnectingMessage = ["PROXY", "CONNECTING"];
export type ProxyConnectedMessage = ["PROXY", "CONNECTED"];
export type ProxyErrorMessage = ["PROXY", "ERROR", string];
export type ProxyAuthRequiredMessage = ["PROXY", "AUTH_REQUIRED", string];
export type ProxyPaymentRequestMessage = ["PROXY", "PAYMENT_REQUIRED", PaymentRequest];

export type ProxyMessage =
  | ProxyConnectingMessage
  | ProxyConnectedMessage
  | ProxyErrorMessage
  | ProxyAuthRequiredMessage
  | ProxyPaymentRequestMessage;

export type ProxyHandlers = {
  onPaymentRequest?: (socket: WebSocket, hop: string, request: PaymentRequest) => Promise<Payment | null>;
  onAuthRequest?: (socket: WebSocket, hop: string, challenge: string) => Promise<NostrEvent | null>;
};

export class ProxyWebSocket extends EventTarget implements WebSocket, ProxyHandlers {
  _readyState: number;

  // events
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onproxy: ((this: WebSocket, hop: string) => any) | null = null;

  // handlers
  onPaymentRequest?: (socket: WebSocket, hop: string, request: PaymentRequest) => Promise<Payment | null>;
  onAuthRequest?: (socket: WebSocket, hop: string, challenge: string) => Promise<NostrEvent | null>;

  url: string;

  hops: string[];
  private hopIndex = 0;

  private ws: WebSocket;
  constructor(proxyUrl: string, hops: string[], handlers?: ProxyHandlers) {
    super();
    if (hops.length === 0) throw new Error("Missing hops");

    this.hops = hops;
    this.url = proxyUrl;
    this.ws = new WebSocket(proxyUrl);
    this.onPaymentRequest = handlers?.onPaymentRequest;
    this.onAuthRequest = handlers?.onAuthRequest;

    this._readyState = WebSocket.CONNECTING;

    // intercept PROXY messages
    this.ws.onmessage = async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as ProxyMessage;
        if (!Array.isArray(message)) throw new Error("Message is not a json array");

        if (message[0] === "PROXY") {
          const hop = this.hops[this.hopIndex];

          switch (message[1]) {
            case "CONNECTING":
              this._readyState = WebSocket.CONNECTING;
              break;
            case "CONNECTED":
              this.hopIndex++;
              this.upstreamProxyConnected();
              break;
            case "PAYMENT_REQUIRED": {
              const [_, _payment, request] = message;
              const payment = await this.onPaymentRequest?.(this, hop, request);

              if (payment === null) {
                // cancel
                this.close();
              } else {
                // retry proxy with payment
                this.ws.send(JSON.stringify(["PROXY", hop, payment]));
              }
              break;
            }
            case "AUTH_REQUIRED": {
              const [_, _auth, challenge] = message;
              const auth = await this.onAuthRequest?.(this, hop, challenge);
              if (auth === null) {
                // cancel
                this.close();
              } else {
                // retry proxy hop with auth
                this.ws.send(JSON.stringify(["PROXY", hop, auth]));
              }
              break;
            }
            case "ERROR":
              this.upstreamProxyError(message[2]);
              break;
            default:
              throw new Error(`Unknown PROXY response: ${message[1]}`);
          }
        }
      } catch (error) {}
    };

    this.ws.onerror = this.upstreamError.bind(this);
    this.ws.onopen = this.upstreamOpen.bind(this);
    this.ws.onclose = this.upstreamClose.bind(this);
  }

  private upstreamOpen(_event: Event) {
    this._readyState = WebSocket.CONNECTING;
    const message: ProxyRequestMessage = ["PROXY", this.hops[this.hopIndex]];
    this.ws.send(JSON.stringify(message));
  }
  private upstreamError(event: Event) {
    this._readyState = this.ws.readyState;
    this.onerror?.(event);
    this.dispatchEvent(new Event("error", event));
  }
  private upstreamClose(event: CloseEvent) {
    // check already closed
    if (this._readyState === WebSocket.CLOSED) return;
    this._readyState = this.ws.readyState;
    this.onclose?.(event);
    this.dispatchEvent(new CloseEvent("close", event));
  }

  private upstreamProxyConnected() {
    this.onproxy?.(this.hops[this.hopIndex - 1]);

    if (this.hopIndex < this.hops.length) {
      const message: ProxyRequestMessage = ["PROXY", this.hops[this.hopIndex]];
      this.ws.send(JSON.stringify(message));
    } else {
      // finished building route
      const event = new Event("open");
      this._readyState = WebSocket.OPEN;
      this.onopen?.(event);
      this.dispatchEvent(event);

      // remove proxy handler
      this.ws.onmessage = (event) => {
        this.onmessage?.(event);
        // @ts-expect-error
        this.dispatchEvent(new MessageEvent("message", event));
      };
    }
  }
  private upstreamProxyError(message?: string) {
    // @ts-expect-error
    const event = new Event("error", { message });
    this._readyState = WebSocket.CLOSED;
    this.onerror?.(event);
    this.ws.close();
    this.dispatchEvent(event);
  }

  // websocket methods
  close(code?: number, reason?: string) {
    this._readyState = WebSocket.CLOSING;
    this.ws.close(code, reason);
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.ws.send(data);
  }

  // forward fields
  get readyState() {
    return this._readyState;
  }
  get extensions() {
    return this.ws.extensions;
  }
  get binaryType() {
    return this.ws.binaryType;
  }
  set binaryType(v) {
    this.ws.binaryType = v;
  }
  get bufferedAmount() {
    return this.ws.bufferedAmount;
  }
  get protocol() {
    return this.ws.protocol;
  }

  // static fields
  static CONNECTING = WebSocket.CONNECTING;
  static OPEN = WebSocket.OPEN;
  static CLOSED = WebSocket.CLOSED;
  static CLOSING = WebSocket.CLOSING;
  CONNECTING = WebSocket.CONNECTING;
  OPEN = WebSocket.OPEN;
  CLOSED = WebSocket.CLOSED;
  CLOSING = WebSocket.CLOSING;
}
