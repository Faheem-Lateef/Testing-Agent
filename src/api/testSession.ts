export interface E2eTestSession {
  adminToken: string;
  userToken: string;
  adminEmail: string;
  userEmail: string;
  categoryId: string;
  productId: string;
  orderId: string;
  userId: string;
}

let activeSession: E2eTestSession | null = null;

export function setE2eSession(session: E2eTestSession): void {
  activeSession = session;
}

export function getE2eSession(): E2eTestSession | null {
  return activeSession;
}

export function clearE2eSession(): void {
  activeSession = null;
}
