import crypto from 'node:crypto';

interface TerminalTicket {
  ticket: string;
  workspaceId: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

export class TerminalTicketService {
  private tickets = new Map<string, TerminalTicket>();
  private ticketLifetimeMs: number;

  constructor(ticketLifetimeMs: number = 60000) {
    this.ticketLifetimeMs = ticketLifetimeMs;
  }

  public createTicket(workspaceId: string): { ticket: string; expiresAt: number } {
    this.cleanExpired();

    const ticket = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const expiresAt = now + this.ticketLifetimeMs;

    this.tickets.set(ticket, {
      ticket,
      workspaceId,
      createdAt: now,
      expiresAt,
      consumed: false,
    });

    return { ticket, expiresAt };
  }

  public consumeTicket(ticketCandidate?: string): { valid: boolean; workspaceId?: string; error?: string } {
    this.cleanExpired();

    if (!ticketCandidate || typeof ticketCandidate !== 'string') {
      return { valid: false, error: 'Terminal ticket is required' };
    }

    const clean = ticketCandidate.trim();
    const item = this.tickets.get(clean);

    if (!item) {
      return { valid: false, error: 'Invalid or non-existent terminal ticket' };
    }

    if (Date.now() > item.expiresAt) {
      this.tickets.delete(clean);
      return { valid: false, error: 'Terminal ticket has expired' };
    }

    if (item.consumed) {
      this.tickets.delete(clean);
      return { valid: false, error: 'Terminal ticket has already been used' };
    }

    // Mark consumed and remove (one-time use)
    item.consumed = true;
    this.tickets.delete(clean);

    return { valid: true, workspaceId: item.workspaceId };
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.tickets.entries()) {
      if (now > item.expiresAt || item.consumed) {
        this.tickets.delete(key);
      }
    }
  }

  public clear(): void {
    this.tickets.clear();
  }
}

export const terminalTicketService = new TerminalTicketService();
