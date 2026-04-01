import { useState, useEffect } from 'react';
import { Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { getAnalyticsOptIn, onAnalyticsPrefChange } from '../lib/telemetryPrefs';
import { enableAnalytics, disableAnalytics } from '../lib/posthog';

interface TelemetryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function TelemetryDialog({ open, onOpenChange }: TelemetryDialogProps) {
    const [analyticsEnabled, setAnalyticsEnabled] = useState<boolean>(
        getAnalyticsOptIn() === true,
    );

    useEffect(() => {
        return onAnalyticsPrefChange(v => setAnalyticsEnabled(v === true));
    }, []);

    const handleToggle = (checked: boolean) => {
        setAnalyticsEnabled(checked);
        if (checked) {
            enableAnalytics();
        } else {
            disableAnalytics();
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => onOpenChange(false)}
            />

            {/* Panel */}
            <div className="relative z-10 w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl shadow-black/40 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))]">
                    <Shield className="h-5 w-5 text-blue-400" />
                    <h2 className="text-base font-semibold text-white">Telemetry &amp; privacy</h2>
                    <button
                        onClick={() => onOpenChange(false)}
                        className="ml-auto text-gray-400 hover:text-white transition-colors text-xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                    {/* GlitchTip section */}
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <ShieldCheck className="h-4 w-4 text-green-400" />
                            <p className="text-sm font-medium text-white">Error tracking <span className="text-xs font-normal text-green-400 ml-1">(GlitchTip · always on)</span></p>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">
                            Captures runtime errors and stack traces so crashes can be investigated and fixed.
                            No personal data beyond an opaque user ID. Session replay is recorded only when
                            an error occurs to help diagnose the issue.
                        </p>
                    </div>

                    <Separator />

                    {/* PostHog section */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                                <ShieldOff className="h-4 w-4 text-gray-400" />
                                <p className="text-sm font-medium text-white">Usage analytics <span className="text-xs font-normal text-gray-400 ml-1">(PostHog · optional)</span></p>
                            </div>
                            <Switch
                                id="telemetry-dialog-toggle"
                                checked={analyticsEnabled}
                                onCheckedChange={handleToggle}
                            />
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">
                            Helps understand which features are used so Fluxy can be improved. No analytics are
                            sent unless you turn this on.
                        </p>
                        <p className="text-xs text-blue-400/80 mt-1.5 flex items-center gap-1">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400/60" />
                            This setting is stored in this browser only.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-[hsl(var(--border))] flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                        Done
                    </Button>
                </div>
            </div>
        </div>
    );
}
