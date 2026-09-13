import { LicenseInfo } from '../types';

// Compatibility shim while App.tsx is kept untouched.
// The legacy subscription/payment system has been retired; the application is always available.
class SubscriptionService {
    public getLicenseStatus(): LicenseInfo {
        return {
            isActive: true,
            expirationDate: Number.MAX_SAFE_INTEGER,
            planName: '本地版本'
        };
    }

    public simulatePaymentSuccess(): LicenseInfo {
        return this.getLicenseStatus();
    }

    public getDaysRemaining(): number {
        return Number.MAX_SAFE_INTEGER;
    }
}

export const PLANS: never[] = [];
export const subscriptionService = new SubscriptionService();
