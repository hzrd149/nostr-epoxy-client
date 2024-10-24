import { CashuMint, CashuWallet, getDecodedToken, getEncodedToken, Proof } from "@cashu/cashu-ts";
import { ProxyWebSocket } from "../src/index";

let proofs: Proof[] = JSON.parse(localStorage.getItem("proofs") || "[]");
let mint: string = localStorage.getItem("mint") || "";

let ws: ProxyWebSocket | WebSocket | undefined = undefined;

const wallets = new Map<string, CashuWallet>();
function getWallet(mint) {
  let wallet = wallets.get(mint);
  if (!wallet) {
    const m = new CashuMint(mint);
    wallet = new CashuWallet(m);
    wallets.set(mint, wallet);
  }
  return wallet;
}

function log(message: string) {
  const entry = document.createElement("div");
  entry.textContent = message;
  document.getElementById("log")?.appendChild(entry);
}

function updateWallet() {
  const total = proofs.reduce((t, p) => t + p.amount, 0);

  document.getElementById("balance")!.textContent = String(total);
  document.getElementById("mint")!.textContent = mint;
}

document.getElementById("topup")!.addEventListener("click", async () => {
  const token = prompt("paste a token");
  if (!token) return;

  const parsed = getDecodedToken(token);
  console.log(parsed);

  proofs = parsed.token[0].proofs;
  mint = parsed.token[0].mint;

  localStorage.setItem("proofs", JSON.stringify(proofs));
  localStorage.setItem("mint", mint);
  updateWallet();
});

document.getElementById("withdraw")!.addEventListener("click", () => {
  const token = getEncodedToken({ token: [{ proofs, mint }] });

  alert(token);
});

const setup = document.getElementById("setup")! as HTMLFormElement;

setup.addEventListener("submit", async (e) => {
  ws?.close();
  e.preventDefault();
  try {
    document.getElementById("log")!.textContent = "";
    setup.disabled = true;

    const proxy = (setup.elements.namedItem("proxy") as HTMLInputElement).value;
    const hops = (setup.elements.namedItem("hops") as HTMLInputElement).value.trim().split("\n").filter(Boolean);

    const url = new URL(proxy);
    for (const hop of hops) url.searchParams.append("hop", hop);

    log("+ Connecting...");

    if (hops.length > 0) {
      const proxy = (ws = new ProxyWebSocket(url.toString()));

      proxy.onPaymentRequest = async (socket, hop, request) => {
        try {
          log(`+ Payment Required`);
          const amountStr = prompt(
            [`Payment required (${request.price}${request.unit ?? ""}/KiB)`, `To relay: ${hop}`].join("\n"),
          );
          if (!amountStr) return null;
          const amount = parseInt(amountStr);

          if (amount) {
            const wallet = getWallet(mint);
            const { send, returnChange } = await wallet.send(amount, proofs);

            proofs = returnChange;
            localStorage.setItem("proofs", JSON.stringify(proofs));
            updateWallet();

            log("+ Paid");
            return send;
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
      ws = new WebSocket(url.toString());
    }

    ws.onopen = () => {
      log("+ Connected");
      filter.style.display = "block";
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
