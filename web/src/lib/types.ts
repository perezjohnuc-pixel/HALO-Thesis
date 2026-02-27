export type UserRole = "user" | "admin";

// Locker status values written by Cloud Functions.
// NOTE: We keep "occupied" for backwards compatibility with earlier drafts.
export type LockerStatus =
  | "available"
  | "reserved"
  | "pending_payment"
  | "active"
  | "occupied"
  | "offline"
  | "error";

export type BookingStatus =
  | "reserved"
  | "pending_payment"
  | "active"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed";

// In the thesis demo we support both cash and e-wallet simulations.
export type PaymentProvider = "gcash" | "maya" | "cash" | "unknown";

export type PaymentMethod = "online" | "cash";

export type FireTimestamp = any; // Firestore Timestamp or serverTimestamp() resolved value

export type UserDoc = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  role: UserRole;
  createdAt?: FireTimestamp;
  lastLoginAt?: FireTimestamp;
};

export type Locker = {
  name?: string;
  location?: string;
  status: LockerStatus;
  occupied?: boolean;
  currentBookingId?: string | null;
  reservedByUserId?: string | null;
  pendingPayment?: boolean;
  reservationExpiresAt?: FireTimestamp | null;
  pendingPaymentExpiresAt?: FireTimestamp | null;
  batteryPct?: number;
  lastHeartbeatAt?: FireTimestamp;
  lastDisinfectionAt?: FireTimestamp;
  lastPaymentAt?: FireTimestamp;
  createdAt?: FireTimestamp;
};

export type Booking = {
  id?: string;
  userId: string;
  lockerId: string;
  status: BookingStatus;
  amount: number; // PHP
  durationMin: number;

  createdAt?: FireTimestamp;
  startAt?: FireTimestamp;
  endAt?: FireTimestamp | null;

  // Server-minted QR
  qrToken?: string;
  qrExpiresAt?: FireTimestamp | null;
  holdExpiresAt?: FireTimestamp | null;
  qrUsedAt?: FireTimestamp | null;

  // Payment
  paidAt?: FireTimestamp | null;
  paymentId?: string | null;
  paymentMethod?: PaymentMethod | null;
  paymentProvider?: PaymentProvider | string | null;

  // Completion/cancel
  cancelledAt?: FireTimestamp | null;
  completedAt?: FireTimestamp | null;
  expiredAt?: FireTimestamp | null;
  failedAt?: FireTimestamp | null;
  failReason?: string | null;

  // Completion metadata (filled by Cloud Functions)
  selectedModes?: string[];
  sequenceName?: string;
  disinfectionOk?: boolean;
};

export type LogEvent = {
  createdAt?: FireTimestamp;
  type: string;
  message: string;
  lockerId?: string | null;
  userId?: string | null;
  payload?: any;
};
