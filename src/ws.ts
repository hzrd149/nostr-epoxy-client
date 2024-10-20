import { Proof } from "@cashu/cashu-ts";

type Product = {
  name: "KiB" | "MiB" | "GiB";
  price: number;
  unit?: string;
  mint: string;
  pubkey: string;
};
type Payment = {
  proofs: Proof[];
  mint: string;
};

export class ProxyWebSocket extends EventTarget implements WebSocket {
  _readyState: number;

  // events
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onproxy: ((this: WebSocket, hop: string) => any) | null = null;

  onPaymentRequest: ((socket: WebSocket, hop: string, products: Product[]) => Promise<Payment | null>) | null = null;

  url: string;

  hops: string[];
  private hopIndex = 0;

  private ws: WebSocket;
  constructor(proxyUrl: string) {
    super();
    const url = new URL(proxyUrl);

    const hops = url.searchParams.getAll("hop");
    if (hops.length === 0) throw new Error("Missing pubkey");

    this.hops = hops;
    this.url = proxyUrl;
    this.ws = new WebSocket(proxyUrl.replace(url.search, "").replace(url.hash, ""));

    this._readyState = WebSocket.CONNECTING;

    // intercept PROXY messages
    this.ws.onmessage = async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as string[];
        if (!Array.isArray(message)) throw new Error("Message is not a json array");

        if (message[0] === "PROXY") {
          switch (message[1]) {
            case "CONNECTING":
              this._readyState = WebSocket.CONNECTING;
              break;
            case "CONNECTED":
              this.hopIndex++;
              this.upstreamProxyConnected();
              break;
            case "PAYMENT_REQUIRED":
              const [_, _payment, products] = message;
              if (!Array.isArray(products)) throw new Error("Invalid products");

              const hop = this.hops[this.hopIndex];
              const payment = await this.onPaymentRequest?.(this, hop, products);

              if (payment === null) {
                // cancel
                this.close();
              } else {
                // retry proxy with payment
                this.ws.send(JSON.stringify(["PROXY", hop, payment]));
              }
              break;
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
    this.ws.send(JSON.stringify(["PROXY", this.hops[this.hopIndex]]));
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
      this.ws.send(JSON.stringify(["PROXY", this.hops[this.hopIndex]]));
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
  private upstreamProxyError(_message?: string) {
    const event = new Event("error");
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
