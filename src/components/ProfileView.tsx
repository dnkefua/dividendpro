import React, { useState } from "react";
import { UserSettings } from "../types";
import { 
  Bell, 
  ShieldCheck, 
  Edit, 
  HelpCircle, 
  FileText, 
  ChevronRight, 
  Key, 
  LogOut, 
  User, 
  Layout, 
  Laptop,
  CheckCircle2,
  RefreshCw,
  CircleDollarSign
} from "lucide-react";

interface ProfileViewProps {
  settings: UserSettings;
  onUpdateSettings: (newSettings: UserSettings) => void;
}

export default function ProfileView({
  settings,
  onUpdateSettings
}: ProfileViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: settings.name,
    email: settings.email
  });

  const handleToggle = (key: keyof Omit<UserSettings, "name" | "email" | "avatarUrl">) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key]
    });
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      ...settings,
      name: formData.name,
      email: formData.email
    });
    setIsEditing(false);
  };

  const toggleProSubscription = () => {
    onUpdateSettings({
      ...settings,
      isPro: !settings.isPro
    });
  };

  return (
    <div className="space-y-8 animate-fade-in" id="settings-view-container">
      {/* Settings Title Header */}
      <div className="mb-6" id="settings-header">
        <h1 className="text-3xl font-extrabold tracking-tight text-primary mb-1">Settings</h1>
        <p className="text-sm text-on-surface-variant font-medium">Manage your account preferences, notifications, security credentials, and premium subscription.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6" id="settings-bento">
        {/* Left Column: Primary preferences */}
        <div className="md:col-span-8 space-y-6">
          
          {/* Profile Card */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm">
            {isEditing ? (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <h3 className="text-lg font-bold text-primary mb-4">Edit Profile</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-2">Display Name</label>
                    <input 
                      type="text" 
                      required
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg text-sm font-semibold text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-2">Email Address</label>
                    <input 
                      type="email" 
                      required
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg text-sm font-semibold text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button 
                    type="button" 
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 text-xs font-bold text-on-surface-variant hover:bg-surface-container rounded-lg"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-4 py-2 text-xs font-bold bg-primary text-on-primary hover:bg-opacity-95 rounded-lg transition-transform active:scale-95"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-secondary-container">
                      <img 
                        alt="Profile avatar" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        src={settings.avatarUrl}
                      />
                    </div>
                    <button 
                      onClick={() => setIsEditing(true)}
                      className="absolute bottom-0 right-0 bg-primary text-white p-1.5 rounded-full border-2 border-white hover:scale-105 active:scale-95 transition-transform"
                    >
                      <Edit className="w-3 h-3" />
                    </button>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-primary flex items-center gap-1.5">{settings.name}</h2>
                    <p className="text-sm text-on-surface-variant font-medium mt-0.5">{settings.email}</p>
                    <div className="mt-2 flex gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-secondary-container text-on-secondary-container">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified Profile
                      </span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setIsEditing(true)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-primary text-on-primary hover:bg-opacity-90 rounded-xl text-xs font-bold transition-transform active:scale-95"
                >
                  Edit Profile
                </button>
              </div>
            )}
          </section>

          {/* Portfolio Global Settings */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-2 pb-2 border-b border-outline-variant/60">
              <CircleDollarSign className="w-5 h-5 text-secondary" />
              <h2 className="text-lg font-bold text-primary">Global Portfolio Settings</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-primary">Baseline Budget</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-on-surface-variant sm:text-sm font-bold">{settings.currency === 'GBP' ? '£' : settings.currency === 'EUR' ? '€' : settings.currency === 'JPY' ? '¥' : '$'}</span>
                  </div>
                  <input
                    type="number"
                    value={settings.portfolioBudget}
                    onChange={(e) => onUpdateSettings({ ...settings, portfolioBudget: Number(e.target.value) })}
                    className="block w-full pl-7 pr-3 py-2 border border-outline-variant rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all sm:text-sm"
                    placeholder="10000"
                  />
                </div>
                <p className="text-[10px] text-on-surface-variant font-medium">Used as the base assumption for portfolio simulators and Top 10 stats.</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-primary">Display Currency</label>
                <select
                  value={settings.currency}
                  onChange={(e) => onUpdateSettings({ ...settings, currency: e.target.value })}
                  className="block w-full pl-3 pr-10 py-2 text-base border border-outline-variant focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary sm:text-sm rounded-lg bg-surface appearance-none"
                >
                  <option value="USD">USD ($) - US Dollar</option>
                  <option value="EUR">EUR (€) - Euro</option>
                  <option value="GBP">GBP (£) - British Pound</option>
                  <option value="CAD">CAD ($) - Canadian Dollar</option>
                  <option value="AUD">AUD ($) - Australian Dollar</option>
                  <option value="JPY">JPY (¥) - Japanese Yen</option>
                </select>
                <p className="text-[10px] text-on-surface-variant font-medium">Globally format all monetary values according to this symbol.</p>
              </div>
            </div>
          </section>

          {/* Notification Preferences */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-2 pb-2 border-b border-outline-variant/60">
              <Bell className="w-5 h-5 text-secondary" />
              <h2 className="text-lg font-bold text-primary">Notification Preferences</h2>
            </div>

            <div className="space-y-4">
              {/* Push Notifications Toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="space-y-0.5 max-w-[80%]">
                  <p className="text-sm font-bold text-primary">Push Notifications</p>
                  <p className="text-xs text-on-surface-variant">Receive instant real-time desktop push notifications for payout events and price volatility triggers.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={settings.pushNotifications}
                    onChange={() => handleToggle("pushNotifications")}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary"></div>
                </label>
              </div>
              <hr className="border-outline-variant/30" />

              {/* Email Alerts Toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="space-y-0.5 max-w-[80%]">
                  <p className="text-sm font-bold text-primary">Email Alerts</p>
                  <p className="text-xs text-on-surface-variant">Receive a daily performance summary and market updates matching items in your watchlists.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={settings.emailAlerts}
                    onChange={() => handleToggle("emailAlerts")}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary"></div>
                </label>
              </div>
              <hr className="border-outline-variant/30" />

              {/* Weekly Performance reports toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="space-y-0.5 max-w-[80%]">
                  <p className="text-sm font-bold text-primary">Weekly Performance Reports</p>
                  <p className="text-xs text-on-surface-variant">Receive an advanced breakdown of your portfolio yield changes, ex-dates, and growth rates every Monday.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={settings.weeklyReports}
                    onChange={() => handleToggle("weeklyReports")}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary"></div>
                </label>
              </div>
            </div>
          </section>

          {/* Display & Security Section */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-2 pb-2 border-b border-outline-variant/60">
              <ShieldCheck className="w-5 h-5 text-secondary" />
              <h2 className="text-lg font-bold text-primary">Display &amp; Security</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Compact Card 1: Compact view */}
              <div className="p-4 bg-surface rounded-xl border border-outline-variant flex flex-col justify-between h-32 hover:border-primary/20 transition-all">
                <div>
                  <p className="text-sm font-bold text-primary">Compact View</p>
                  <p className="text-[10px] text-on-surface-variant font-medium leading-relaxed mt-1">
                    Maximize information density for active scanning tables and historical analysis bar charts.
                  </p>
                </div>
                <div className="flex justify-end pt-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={settings.compactView}
                      onChange={() => handleToggle("compactView")}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary"></div>
                  </label>
                </div>
              </div>

              {/* Compact Card 2: Biometric Unlock */}
              <div className="p-4 bg-surface rounded-xl border border-outline-variant flex flex-col justify-between h-32 hover:border-primary/20 transition-all">
                <div>
                  <p className="text-sm font-bold text-primary">Biometric Unlock</p>
                  <p className="text-[10px] text-on-surface-variant font-medium leading-relaxed mt-1">
                    Secure FaceID or TouchID unlock capabilities on supported browser devices.
                  </p>
                </div>
                <div className="flex justify-end pt-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={settings.biometricUnlock}
                      onChange={() => handleToggle("biometricUnlock")}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary"></div>
                  </label>
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* Right Column: Premium Subscription & Meta info */}
        <div className="md:col-span-4 space-y-6">
          
          {/* Subscription Black Accent Card */}
          <section className="bg-primary text-on-primary rounded-2xl p-6 relative overflow-hidden shadow-md">
            {/* Ambient visual overlay */}
            <div className="absolute -top-12 -right-12 w-36 h-36 bg-secondary-container opacity-10 rounded-full"></div>
            
            <div className="relative z-10 space-y-5">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-secondary-container">Pro Plan</h2>
                  <p className="text-xs opacity-80 mt-1">Full access to advanced dividend forecasts</p>
                </div>
                <div className="bg-white/15 p-2 rounded-xl text-secondary-container">
                  <Layout className="w-5 h-5 fill-current" />
                </div>
              </div>

              <div className="space-y-2 text-xs font-mono border-t border-white/10 pt-4">
                <div className="flex justify-between">
                  <span className="opacity-75">Subscription Status:</span>
                  <span className="font-bold text-secondary-container">{settings.isPro ? "ACTIVE" : "FREE TRIAL"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-75">Renewal Date:</span>
                  <span>Oct 24, 2024</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-75">Monthly Charge:</span>
                  <span>$29.99 / mo</span>
                </div>
              </div>

              <button 
                type="button"
                onClick={toggleProSubscription}
                className="w-full py-3 bg-secondary-container text-on-secondary-container hover:bg-secondary transition-all font-extrabold text-sm rounded-xl tracking-wide active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                {settings.isPro ? "Downgrade Subscription" : "Re-activate Premium Pro"}
              </button>
            </div>
          </section>

          {/* Resources links list */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-outline font-mono uppercase tracking-wider">Resources</h3>
            <nav className="space-y-1.5">
              <a href="#help" className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container-low transition-colors group">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-outline group-hover:text-primary" />
                  <span className="text-sm font-semibold text-primary">Help Center</span>
                </div>
                <ChevronRight className="w-4 h-4 text-outline" />
              </a>
              <a href="#privacy" className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container-low transition-colors group">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-outline group-hover:text-primary" />
                  <span className="text-sm font-semibold text-primary">Privacy Policy</span>
                </div>
                <ChevronRight className="w-4 h-4 text-outline" />
              </a>
              <a href="#terms" className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container-low transition-colors group">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-outline group-hover:text-primary" />
                  <span className="text-sm font-semibold text-primary">Terms of Service</span>
                </div>
                <ChevronRight className="w-4 h-4 text-outline" />
              </a>
            </nav>
          </section>

          {/* Danger Zone */}
          <section className="px-6">
            <button 
              onClick={() => alert("Sign out is simulated for local demo session.")}
              className="w-full flex items-center justify-center gap-2 py-3 border border-red-500 text-error hover:bg-red-50/20 font-bold rounded-xl text-sm transition-all active:scale-95"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </section>

        </div>
      </div>
    </div>
  );
}
