export type UserRole = "user" | "admin";

export type LockerStatus =
  | "available"
  | "reserved"
  | "confirmed"
  | "in_use"
  | "disinfecting"
  | "awaiting_payment"
  | "awaiting_retrieval"
  | "maintenance"
  | "offline"
  | "error";

export type BookingStatus =
  | "awaiting_booking_qr"
  | "confirmed"
  | "mode_selected"
  | "waiting_for_helmet"
  | "in_use"
  | "disinfecting"
  | "awaiting_payment"
  | "paid"
  | "awaiting_retrieval_qr"
  | "retrieval_verified"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export type ServiceType = "locker_only" | "disinfect_only" | "combined";

export type PaymentProvider = "gcash" | "maya" | "cash" | "unknown";

export type PaymentMethod = "online" | "cash";

export type FireTimestamp = any;

export type UserDoc = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  publicId?: string | null;
  personalQrActive?: boolean;
  role: UserRole;
  createdAt?: FireTimestamp;
  lastLoginAt?: FireTimestamp;
};

export type Locker = {
  id?: string;
  name?: string;
  location?: string;
  status: LockerStatus;
  occupied?: boolean;
  currentBookingId?: string | null;
  reservedByUserId?: string | null;
  pendingPayment?: boolean;
  reservationExpiresAt?: FireTimestamp | null;
  pendingPaymentExpiresAt?: FireTimestamp | null;
  battery?: number;
  batteryPct?: number;
  lastHeartbeatAt?: FireTimestamp;
  lastDisinfectionAt?: FireTimestamp;
  lastPaymentAt?: FireTimestamp;
  lastCompletedAt?: FireTimestamp;
  createdAt?: FireTimestamp;
  updatedAt?: FireTimestamp;
};

export type Booking = {
  id?: string;
  userId: string;
  lockerId: string;
  status: BookingStatus;

  serviceType?: ServiceType | null;
  selectedModes?: string[];
  sequenceName?: string | null;
  durationMin?: number;

  bookingQrVerified?: boolean;
  bookingQrVerifiedAt?: FireTimestamp | null;

  helmetDetected?: boolean;
  helmetDetectedAt?: FireTimestamp | null;
  doorClosed?: boolean;
  doorClosedAt?: FireTimestamp | null;

  programStarted?: boolean;
  programStartedAt?: FireTimestamp | null;
  programFinished?: boolean;
  programFinishedAt?: FireTimestamp | null;
  programRunId?: string | null;
  programStep?: string | null;
  programStepEndsAt?: FireTimestamp | null;

  amountDue?: number;
  amountPaid?: number;
  paymentStatus?: "unpaid" | "paid" | "failed" | string;
  paymentMethod?: PaymentMethod | null;
  paymentProvider?: PaymentProvider | string | null;
  paymentConfirmed?: boolean;
  paymentPayload?: string | null;
  paymentId?: string | null;
  paidAt?: FireTimestamp | null;

  retrievalQrGenerated?: boolean;
  retrievalQrToken?: string | null;
  retrievalQrVerified?: boolean;
  retrievalQrVerifiedAt?: FireTimestamp | null;

  deviceStatus?: {
    lock?: boolean;
    mist?: boolean;
    fan?: boolean;
    uvc?: boolean;
  };

  createdAt?: FireTimestamp;
  updatedAt?: FireTimestamp;
  startedAt?: FireTimestamp | null;
  startAt?: FireTimestamp | null;
  endAt?: FireTimestamp | null;
  cancelledAt?: FireTimestamp | null;
  completedAt?: FireTimestamp | null;
  expiredAt?: FireTimestamp | null;
  failedAt?: FireTimestamp | null;
  failReason?: string | null;
};

export type LogEvent = {
  createdAt?: FireTimestamp;
  type: string;
  message: string;
  lockerId?: string | null;
  bookingId?: string | null;
  userId?: string | null;
  payload?: any;
};
