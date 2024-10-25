import { getDecodedToken, getEncodedToken } from "@cashu/cashu-ts";
import { SimplePool } from "nostr-tools";
import { SubCloser } from "nostr-tools/abstract-pool";
import Handlebars from "handlebars";

import { ProxyWebSocket } from "../src/index";
import LocalWallet from "./local-wallet";

const wallet = new LocalWallet("cashu");
// @ts-expect-error
window.wallet = wallet;
const pool = new SimplePool();

let ws: ProxyWebSocket | WebSocket | undefined = undefined;

function log(message: string) {
  const entry = document.createElement("div");
  entry.textContent = message;
  document.getElementById("log")?.appendChild(entry);
}

function updateWallet() {
  const total = wallet.getBalance();

  document.getElementById("balance")!.textContent = String(total);
  document.getElementById("mint")!.textContent = wallet.mintUrl ?? "";
}

document.getElementById("topup")!.addEventListener("click", async () => {
  const token = prompt("paste a token");
  if (!token) return;

  const parsed = getDecodedToken(token);
  for (const entry of parsed.token) {
    await wallet.receive(entry);
    updateWallet();
  }
});

document.getElementById("withdraw")!.addEventListener("click", async () => {
  const entry = await wallet.send(wallet.getBalance());
  const token = getEncodedToken({ token: [entry] });

  alert(token);
});

var proxyCardTemplate = `
  <div class="proxy-card">
    <div class="title">
      <img class="image" src="{{profile.image}}"/>
      <h4 class="name">{{profile.name}}</h4>
      <span style="margin-left: .5em;">{{networks}}</span>
    </div>
    <p class="about">{{profile.about}}</p>
    <p>{{price}}{{unit}}/KiB</p>
    <small>{{mint}}</small>
    <a href="#" class="select">Select</a>
  </div>
`;
var proxyTemplate = Handlebars.compile(proxyCardTemplate);

let sub: SubCloser | undefined;
const findProxyButton = document.getElementById("find-proxy")!;
const proxyList = document.getElementById("proxies")!;
findProxyButton.addEventListener("click", async () => {
  if (sub) {
    sub.close();
    sub = undefined;
    findProxyButton.textContent = "Find Proxy";
    proxyList.innerHTML = "";
    proxyList.style.display = "none";
  } else {
    findProxyButton.textContent = "Cancel";
    proxyList.innerHTML = "";
    proxyList.style.removeProperty("display");

    sub = pool.subscribeMany(
      ["wss://relay.damus.io/", "wss://relay.primal.net/", "wss://nostrue.com/"],
      [{ kinds: [10377], since: Math.round(Date.now() / 1000) - 60 * 60 }],
      {
        onevent: (event) => {
          try {
            document.getElementById(event.pubkey)?.remove();

            const mint = event.tags.find((t) => t[0] === "mint")?.[1];
            const price = event.tags.find((t) => t[0] === "price")?.[1];
            const unit = event.tags.find((t) => t[0] === "price")?.[2];
            const networks = event.tags.filter((t) => t[0] === "n").map((t) => t[1]);
            const addresses: Record<string, string> = event.tags
              .filter((t) => t[0] === "url")
              .reduce((dir, t) => ({ ...dir, [t[2]]: t[1] }), {});
            const container = document.createElement("div");
            container.innerHTML = proxyTemplate({
              profile: JSON.parse(event.content),
              price,
              unit,
              mint,
              networks: networks.join(", "),
            });

            container.querySelector(".select")?.addEventListener("click", (e) => {
              e.preventDefault();
              const input: HTMLInputElement = document.querySelector('input[name="proxy"]')!;
              input.value = addresses.clearnet;

              sub!.close();
              sub = undefined;
              findProxyButton.textContent = "Find Proxy";
              proxyList.innerHTML = "";
              proxyList.style.display = "none";
            });

            container.id = event.pubkey;
            proxyList.appendChild(container);
          } catch (error) {
            console.log(error);
          }
        },
      },
    );
  }
});

const setup = document.getElementById("setup")! as HTMLFormElement;

setup.addEventListener("submit", async (e) => {
  ws?.close();
  e.preventDefault();
  try {
    document.getElementById("log")!.textContent = "";
    setup.disabled = true;

    const proxyUrl = (setup.elements.namedItem("proxy") as HTMLInputElement).value;
    const hops = (setup.elements.namedItem("hops") as HTMLInputElement).value.trim().split("\n").filter(Boolean);

    log("+ Connecting...");

    if (hops.length > 0) {
      const proxy = (ws = new ProxyWebSocket(proxyUrl, hops));

      proxy.onPaymentRequest = async (socket, hop, request) => {
        try {
          log(`+ Payment Required`);
          const amountStr = prompt(
            [`Payment required (${request.price}${request.unit ?? ""}/KiB)`, `To relay: ${hop}`].join("\n"),
          );
          if (!amountStr) return null;
          const amount = parseInt(amountStr);
          const token = await wallet.send(amount);
          updateWallet();

          if (amount) {
            log("+ Paid");
            return token.proofs;
          }
        } catch (error) {
          if (error instanceof Error) alert(error.message);
        }
        return null;
      };

      proxy.onproxy = (hop) => {
        log(`+ Connected to ${hop}`);
      };
    } else {
      ws = new WebSocket(proxyUrl);
    }

    ws.onopen = () => {
      log("+ Connected");
      filter.style.display = "block";
    };

    ws.onerror = (e) => {
      // @ts-expect-error
      log("+ Error " + e.message) ?? "";
    };

    ws.onclose = () => {
      log("+ Closed");
      filter.style.display = "none";
    };

    ws.onmessage = (event) => {
      log("< " + event.data);
    };
  } catch (error) {
    if (error instanceof Error) alert(error.message);
  }

  setup.disabled = false;
});

const filter = document.getElementById("filter")! as HTMLFormElement;
filter.addEventListener("submit", (e) => {
  e.preventDefault();

  const message = (filter.elements.namedItem("message") as HTMLInputElement).value;
  if (ws) {
    log(`> ${message}`);
    ws.send(message);
  }
});

updateWallet();
