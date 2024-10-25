import { CashuMint, CashuWallet, Proof, TokenEntry } from "@cashu/cashu-ts";

export default class LocalWallet {
  private mint?: CashuMint;
  private wallet?: CashuWallet;
  private proofs: Proof[] = [];
  private readonly storageKey: string;

  get unit() {
    return this.wallet?.unit;
  }
  get mintUrl() {
    return this.mint?.mintUrl;
  }

  constructor(storageKey = "cashu-wallet") {
    this.storageKey = storageKey;
    this.load();
  }

  async load() {
    try {
      const storedProofs = localStorage.getItem(this.storageKey);
      if (storedProofs) {
        const token: TokenEntry = JSON.parse(storedProofs);
        this.mint = new CashuMint(token.mint);
        this.wallet = new CashuWallet(this.mint);
        this.proofs = token.proofs;
      }
    } catch (error) {
      console.error("Error loading proofs from localStorage:", error);
    }
  }

  async save() {
    if (!this.mint) throw new Error("Wallet not setup");
    try {
      const token: TokenEntry = {
        proofs: this.proofs,
        mint: this.mint.mintUrl,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(token));
    } catch (error) {
      console.error("Error saving proofs to localStorage:", error);
    }
  }

  public getBalance() {
    return this.proofs.reduce((t, p) => t + p.amount, 0);
  }

  public async send(amount: number, opts?: Parameters<CashuWallet["send"]>[2]) {
    if (!this.mint || !this.wallet) throw new Error("Wallet not setup");

    try {
      const { send, returnChange } = await this.wallet.send(amount, this.proofs, opts);
      this.proofs = returnChange;
      await this.save();
      const token: TokenEntry = {
        proofs: send,
        mint: this.mint.mintUrl,
      };
      return token;
    } catch (error) {
      console.error("Error sending tokens:", error);
      throw error;
    }
  }

  public async receive(token: TokenEntry, opts?: Parameters<CashuWallet["receiveTokenEntry"]>[1]) {
    if (!this.mint || !this.wallet) {
      this.mint = new CashuMint(token.mint);
      this.wallet = new CashuWallet(this.mint);
    } else if (token.mint !== this.mint.mintUrl) {
      throw new Error("Cant receive tokens from another mint");
    }

    try {
      const received = await this.wallet.receiveTokenEntry(token);
      this.proofs = [...this.proofs, ...received];
      await this.save();
      return this.getBalance();
    } catch (error) {
      console.error("Error receiving tokens:", error);
      throw error;
    }
  }
}
