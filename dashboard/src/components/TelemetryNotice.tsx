import { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { TelemetryDialog } from './TelemetryDialog';
import { getAnalyticsOptIn, setAnalyticsOptIn, onAnalyticsPrefChange } from '../lib/telemetryPrefs';
import { enableAnalytics, disableAnalytics } from '../lib/posthog';

export function TelemetryNotice({ renderTrigger }: {
    renderTrigger?: (openDialog: () => void) => React.ReactNode;
}) {
    const [pref, setPref] = useState<boolean | null>(getAnalyticsOptIn);
    const [draftEnabled, setDraftEnabled] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => onAnalyticsPrefChange(setPref), []);

    const handleSave = () => {
        if (draftEnabled) {
            enableAnalytics();
        } else {
            setAnalyticsOptIn(false);
            disableAnalytics();
        }
    };

    return (
        <>
            {/* First-visit banner - disappears once a choice is saved */}
            {pref === null && (
                <div className="mb-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white flex items-center gap-2">
                            <Shield className="h-4 w-4 text-blue-400 shrink-0" />
                            Telemetry &amp; privacy
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Fluxy uses <span className="text-gray-200">GlitchTip</span> for error tracking (always&nbsp;on) and{' '}
                            <span className="text-gray-200">PostHog</span> for optional usage analytics - off by default.{' '}
                            <button
                                onClick={() => setDialogOpen(true)}
                                className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                            >
                                Details
                            </button>
                        </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={draftEnabled}
                                onCheckedChange={setDraftEnabled}
                                id="telemetry-banner-toggle"
                            />
                            <label htmlFor="telemetry-banner-toggle" className="text-xs text-gray-300 select-none cursor-pointer">
                                Analytics
                            </label>
                        </div>
                        <Button size="sm" onClick={handleSave} variant="outline">
                            Save &amp; dismiss
                        </Button>
                    </div>
                </div>
            )}

            {/* Persistent trigger (rendered into sidebar by Layout) */}
            {renderTrigger?.(() => setDialogOpen(true))}

            <TelemetryDialog open={dialogOpen} onOpenChange={setDialogOpen} />
        </>
    );
}
