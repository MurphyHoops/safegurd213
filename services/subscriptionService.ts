
import { LicenseInfo, SubscriptionPlan } from '../types';

export const PLANS: SubscriptionPlan[] = [
    { id: '1_MONTH', name: '月度会员 (30天)', durationMonths: 1, price: 300, tag: '尝鲜' },
    { id: '4_MONTHS', name: '季度加强版 (120天)', durationMonths: 4, price: 1000, tag: '推荐', popular: true },
    { id: '12_MONTHS', name: '年度至尊版 (365天)', durationMonths: 12, price: 2500, tag: '超值' }
];

const STORAGE_KEY = 'app_license_data_v1';

class SubscriptionService {
    
    // In a real app, this would verify with a backend server
    public getLicenseStatus(): LicenseInfo {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) {
                return { isActive: false, expirationDate: 0, planName: '' };
            }
            const parsed = JSON.parse(data);
            const now = Date.now();
            
            // Check expiry
            if (now > parsed.expirationDate) {
                return { isActive: false, expirationDate: parsed.expirationDate, planName: parsed.planName };
            }

            return { isActive: true, expirationDate: parsed.expirationDate, planName: parsed.planName };
        } catch (e) {
            return { isActive: false, expirationDate: 0, planName: '' };
        }
    }

    public simulatePaymentSuccess(planId: string): LicenseInfo {
        const plan = PLANS.find(p => p.id === planId);
        if (!plan) throw new Error("Invalid Plan");

        const currentStatus = this.getLicenseStatus();
        const now = Date.now();
        
        // If already active, extend from current expiration. Else start from now.
        const baseTime = (currentStatus.isActive && currentStatus.expirationDate > now) 
            ? currentStatus.expirationDate 
            : now;

        const durationMs = plan.durationMonths * 30 * 24 * 60 * 60 * 1000; // Approx month calculation
        const newExpiration = baseTime + durationMs;

        const newLicense = {
            isActive: true,
            expirationDate: newExpiration,
            planName: plan.name
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(newLicense));
        return newLicense;
    }

    public getDaysRemaining(): number {
        const status = this.getLicenseStatus();
        if (!status.isActive) return 0;
        const ms = status.expirationDate - Date.now();
        return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
    }
}

export const subscriptionService = new SubscriptionService();
