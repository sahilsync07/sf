import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/appStore';
import { toast } from 'vue3-toastify';
import { Preferences } from '@capacitor/preferences';

const isLoginModalOpen = ref(false);

const hashPassword = async (msg) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(msg);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export function useAdmin() {
    const appStore = useAppStore();
    const { isAdmin, isSuperAdmin } = storeToRefs(appStore);

    const checkAdminState = async () => {
        try {
            const { value } = await Preferences.get({ key: 'sf_admin_role' });
            if (value === 'admin') {
                appStore.setAdmin(true);
                appStore.setSuperAdmin(false);
            } else if (value === 'superadmin') {
                appStore.setAdmin(false);
                appStore.setSuperAdmin(true);
            }
        } catch (e) {
            console.error('Failed to load admin state', e);
        }
    };

    const openAdminLogin = () => {
        isLoginModalOpen.value = true;
    };

    const logout = async () => {
        appStore.setAdmin(false);
        appStore.setSuperAdmin(false);
        await Preferences.remove({ key: 'sf_admin_role' });
        toast.info("Logged out", { autoClose: 2000 });
    };

    const login = async (password) => {
        if (!password) return false;

        const hash = await hashPassword(password);

        // Hashes for 'admin123' and 'superadmin'
        if (hash === "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9") {
            appStore.setAdmin(true);
            appStore.setSuperAdmin(false);
            await Preferences.set({ key: 'sf_admin_role', value: 'admin' });
            toast.success("Admin Mode Enabled", { autoClose: 2000 });
            isLoginModalOpen.value = false;
            return true;
        } else if (hash === "889a3a791b3875cfae413574b53da4bb8a90d53e7bfb616a1b24479e390c29ed") {
            appStore.setAdmin(false);
            appStore.setSuperAdmin(true);
            await Preferences.set({ key: 'sf_admin_role', value: 'superadmin' });
            toast.success("Super Admin Mode Enabled", { autoClose: 2000 });
            isLoginModalOpen.value = false;
            return true;
        } else {
            toast.error("Incorrect password", { autoClose: 3000 });
            return false;
        }
    };

    return {
        isAdmin,
        isSuperAdmin,
        isLoginModalOpen,
        openAdminLogin,
        login,
        logout,
        checkAdminState
    };
}
