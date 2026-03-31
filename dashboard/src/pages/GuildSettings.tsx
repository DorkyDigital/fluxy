import { useParams, Link } from 'react-router-dom';
import { useGuildData } from '../hooks/useGuildData';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { useState, useCallback, useEffect } from 'react';
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react';
import {
  ArrowLeft, Settings, Shield, MessageSquare, Gavel,
  Terminal, Ticket, Bug, Save, Loader2,
  Plus, Trash2, X, Lock, Smile, UserMinus, ShieldCheck, Star,
} from 'lucide-react';
import type {
  GuildSettings as GuildSettingsType,
  GuildDetail,
  AutomodLevel,
  CustomCommand,
  HoneypotEntry,
  LogChannelOverrides,
  Starboard,
} from '../lib/api';
import { api } from '../lib/api';
import WelcomeEditor from '../components/WelcomeEditor';

function roleName(name: string): string {
  return name.startsWith('@') ? name : `@${name}`;
}

function channelName(channels: GuildDetail['channels'], id: string | null | undefined): string {
  if (!id) return '#unknown-channel';
  const ch = channels.find(c => c.id === id);
  return ch?.name ? `#${ch.name}` : `#${id}`;
}

function ChannelSelect({ channels, value, onChange, placeholder = 'Select channel' }: {
  channels: GuildDetail['channels'];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  const categories = channels
    .filter(c => c.type === 4)
    .sort((a, b) => a.position - b.position);
  const selectableChannels = channels.filter(c => c.type !== 4);
  const uncategorized = selectableChannels
    .filter(c => !c.parent_id)
    .sort((a, b) => a.position - b.position);

  const grouped: Array<{ label: string; id: string; isCategory: boolean }> = [];
  const includedIds = new Set<string>();

  for (const ch of uncategorized) {
    grouped.push({ label: `# ${ch.name}`, id: ch.id, isCategory: false });
    includedIds.add(ch.id);
  }

  for (const cat of categories) {
    grouped.push({ label: cat.name.toUpperCase(), id: cat.id, isCategory: true });
    const children = selectableChannels
      .filter(c => c.parent_id === cat.id)
      .sort((a, b) => a.position - b.position);
    for (const ch of children) {
      grouped.push({ label: `  # ${ch.name}`, id: ch.id, isCategory: false });
      includedIds.add(ch.id);
    }
  }

  const needsFallback = value && value !== '__none__' && !includedIds.has(value);

  return (
    <Select value={value ?? '__none__'} onValueChange={v => onChange(v === '__none__' ? null : v)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        {needsFallback && (
          <SelectItem key={value} value={value!}>#{channels.find(c => c.id === value)?.name || value}</SelectItem>
        )}
        {grouped.map(item =>
          item.isCategory ? (
            <div key={item.id} className="px-2 py-1.5 text-xs font-semibold text-muted-foreground select-none">
              {item.label}
            </div>
          ) : (
            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
          )
        )}
      </SelectContent>
    </Select>
  );
}

function RoleSelect({ roles, value, onChange, placeholder = 'Select role' }: {
  roles: GuildDetail['roles'];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  const sorted = [...roles].sort((a, b) => b.position - a.position);
  return (
    <Select value={value ?? '__none__'} onValueChange={v => onChange(v === '__none__' ? null : v)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        {sorted.map(r => (
          <SelectItem key={r.id} value={r.id}>{roleName(r.name)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const LOG_EVENT_TYPES = [
  { key: 'member_join', label: 'Member Join', desc: 'When a member joins the server' },
  { key: 'member_leave', label: 'Member Leave', desc: 'When a member leaves the server' },
  { key: 'member_role_update', label: 'Member Role Update', desc: 'When a member\'s roles change' },
  { key: 'voice_join', label: 'Voice Join', desc: 'When a user joins a voice channel' },
  { key: 'voice_leave', label: 'Voice Leave', desc: 'When a user leaves a voice channel' },
  { key: 'voice_move', label: 'Voice Move', desc: 'When a user moves between voice channels' },
  { key: 'message_delete', label: 'Message Delete', desc: 'When a message is deleted' },
  { key: 'message_edit', label: 'Message Edit', desc: 'When a message is edited' },
  { key: 'reaction_add', label: 'Reaction Add', desc: 'When a reaction is added to a message' },
  { key: 'reaction_remove', label: 'Reaction Remove', desc: 'When a reaction is removed from a message' },
  { key: 'channel_create', label: 'Channel Create', desc: 'When a channel is created' },
  { key: 'channel_delete', label: 'Channel Delete', desc: 'When a channel is deleted' },
  { key: 'channel_update', label: 'Channel Update', desc: 'When a channel is updated' },
  { key: 'role_create', label: 'Role Create', desc: 'When a role is created' },
  { key: 'role_delete', label: 'Role Delete', desc: 'When a role is deleted' },
  { key: 'role_update', label: 'Role Update', desc: 'When a role is updated' },
  { key: 'channel_pins_update', label: 'Message Pinned', desc: 'When a message is pinned or unpinned' },
  { key: 'webhooks_update', label: 'Webhooks Update', desc: 'When a webhook is created, edited, or deleted' },
  { key: 'guild_emojis_update', label: 'Emojis Update', desc: 'When a server emoji is created, edited, or deleted' },
  { key: 'invite_create', label: 'Invite Create', desc: 'When an invite link is created' },
  { key: 'invite_delete', label: 'Invite Delete', desc: 'When an invite link is deleted or expires' },
];

function GeneralTab({ settings, guild, onSave, saving }: TabProps) {
  const [prefixes, setPrefixes] = useState(settings.prefixes?.join(', ') || settings.prefix || '!');
  const [staffRoleId, setStaffRoleId] = useState(settings.staffRoleId);
  const [staffChannelId, setStaffChannelId] = useState(settings.staffChannelId);
  const [staffInboxChannelId, setStaffInboxChannelId] = useState(settings.staffInboxChannelId);
  const [serverLogChannelId, setServerLogChannelId] = useState(settings.serverLogChannelId);
  const [logOverrides, setLogOverrides] = useState<LogChannelOverrides>(settings.logChannelOverrides);
  const [autoroleId, setAutoroleId] = useState(settings.autoroleId);
  const [raidDisableAutorole, setRaidDisableAutorole] = useState(settings.raidDisableAutorole ?? false);
  const [blacklisted, setBlacklisted] = useState<string[]>(settings.blacklistedChannels || []);
  const [disabledLogEvents, setDisabledLogEvents] = useState<string[]>(settings.disabledLogEvents || []);

  const toggleLogEvent = (key: string) => {
    setDisabledLogEvents(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSave = () => {
    const parsed = prefixes.split(',').map(p => p.trim()).filter(Boolean);
    onSave({
      prefixes: parsed,
      staffRoleId,
      staffChannelId,
      staffInboxChannelId,
      serverLogChannelId,
      logChannelOverrides: logOverrides,
      autoroleId,
      raidDisableAutorole,
      blacklistedChannels: blacklisted,
      disabledLogEvents,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Command Prefixes</CardTitle>
          <CardDescription>The characters typed before a command name, like <code className="text-xs bg-[hsl(var(--muted))] px-1 py-0.5 rounded">!help</code>. Separate multiple prefixes with commas.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input value={prefixes} onChange={e => setPrefixes(e.target.value)} placeholder="!, f!" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff Setup</CardTitle>
          <CardDescription>Choose who your staff are and where their alerts go</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Staff Role</Label>
              <RoleSelect roles={guild.roles} value={staffRoleId} onChange={setStaffRoleId} />
              <p className="text-xs text-gray-500">Members with this role can use staff commands</p>
            </div>
            <div className="space-y-2">
              <Label>Staff Channel</Label>
              <ChannelSelect channels={guild.channels} value={staffChannelId} onChange={setStaffChannelId} />
              <p className="text-xs text-gray-500">Private channel for staff discussions</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Staff Inbox Channel</Label>
            <ChannelSelect channels={guild.channels} value={staffInboxChannelId} onChange={setStaffInboxChannelId} placeholder="Select inbox channel" />
            <p className="text-xs text-gray-500">Where user reports and alerts get sent for staff to review</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log Channels</CardTitle>
          <CardDescription>Where Fluxy sends log messages about what happens in your server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Server Events Log</Label>
              <ChannelSelect channels={guild.channels} value={serverLogChannelId} onChange={setServerLogChannelId} />
              <p className="text-xs text-gray-500">Joins, leaves, message edits/deletes, role changes, etc.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Split Logs by Category</CardTitle>
          <CardDescription>Send specific event types to different channels instead of the default server log. Leave empty to use the default.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: 'member' as const, label: 'Member Events', desc: 'Joins, leaves, role updates' },
            { key: 'voice' as const, label: 'Voice Events', desc: 'Voice joins, leaves, moves' },
            { key: 'message' as const, label: 'Message Events', desc: 'Edits, deletes, pins' },
            { key: 'role' as const, label: 'Role Events', desc: 'Role creates, deletes, updates' },
            { key: 'channel' as const, label: 'Channel Events', desc: 'Channel creates, deletes, updates' },
            { key: 'reaction' as const, label: 'Reaction Events', desc: 'Reaction adds, removes' },
            { key: 'server' as const, label: 'Server Events', desc: 'Webhooks, emojis, invites' },
          ].map(cat => (
            <div key={cat.key} className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
              <div>
                <p className="text-sm font-medium text-white">{cat.label}</p>
                <p className="text-xs text-gray-400">{cat.desc}</p>
              </div>
              <ChannelSelect
                channels={guild.channels}
                value={logOverrides[cat.key]}
                onChange={v => setLogOverrides(prev => ({ ...prev, [cat.key]: v }))}
                placeholder="Default channel"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server Event Filters</CardTitle>
          <CardDescription>Pick which events show up in your server events log. Everything is logged by default. Turn off anything that clutters your logs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {LOG_EVENT_TYPES.map(evt => (
            <div key={evt.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{evt.label}</p>
                <p className="text-xs text-gray-400">{evt.desc}</p>
              </div>
              <Switch
                checked={!disabledLogEvents.includes(evt.key)}
                onCheckedChange={() => toggleLogEvent(evt.key)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto Role</CardTitle>
          <CardDescription>Automatically give this role to every new member when they join</CardDescription>
        </CardHeader>
        <CardContent>
          <RoleSelect roles={guild.roles} value={autoroleId} onChange={setAutoroleId} placeholder="No auto role" />
          {autoroleId && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div>
                <p className="text-sm font-medium">Disable during raids</p>
                <p className="text-xs text-muted-foreground">Skip autorole when a raid is detected (10+ joins in 15s)</p>
              </div>
              <Switch checked={raidDisableAutorole} onCheckedChange={setRaidDisableAutorole} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ignored Channels</CardTitle>
          <CardDescription>Fluxy will not respond to commands in these channels</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {blacklisted.map(id => {
              const ch = guild.channels.find(c => c.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  #{ch?.name || id}
                  <X className="h-3 w-3 cursor-pointer" onClick={() =>
                    setBlacklisted(prev => prev.filter(c => c !== id))
                  } />
                </Badge>
              );
            })}
          </div>
          <ChannelSelect
            channels={guild.channels.filter(c => !blacklisted.includes(c.id))}
            value={null}
            onChange={v => v && setBlacklisted(prev => [...prev, v])}
            placeholder="Add channel to ignore..."
          />
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function AutomodTab({ settings, guild, onSave, saving }: TabProps) {
  const [automod, setAutomod] = useState(settings.automod);

  const update = (patch: Partial<typeof automod>) => setAutomod(prev => ({ ...prev, ...patch }));
  const updateSpam = (patch: Partial<typeof automod.spam>) =>
    setAutomod(prev => ({ ...prev, spam: { ...prev.spam, ...patch } }));
  const updateRaid = (patch: Partial<typeof automod.raid>) =>
    setAutomod(prev => ({ ...prev, raid: { ...prev.raid, ...patch } }));

  const handleSave = () => onSave({ automod });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Automod Level</CardTitle>
          <CardDescription>A quick way to set all automod rules at once. You can still customize individual settings below.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={automod.level} onValueChange={v => update({ level: v as AutomodLevel })}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="minimal">Minimal</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Protection Features</CardTitle>
          <CardDescription>Turn individual protections on or off</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: 'antiSpam' as const, label: 'Anti-Spam', desc: 'Stop users from flooding the chat with rapid messages' },
            { key: 'antiLink' as const, label: 'Anti-Link', desc: 'Block links that are not on the allowed list' },
            { key: 'antiReactionSpam' as const, label: 'Anti-Reaction Spam', desc: 'Stop users from spamming reactions on messages' },
            { key: 'ghostPing' as const, label: 'Ghost Ping Detection', desc: 'Catch when someone mentions a user then quickly deletes the message' },
          ].map(mod => (
            <div key={mod.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{mod.label}</p>
                <p className="text-xs text-gray-400">{mod.desc}</p>
              </div>
              <Switch
                checked={automod[mod.key]}
                onCheckedChange={v => update({ [mod.key]: v })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spam Sensitivity</CardTitle>
          <CardDescription>Control how strict the spam filter is. Lower numbers = stricter.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Messages before flag</Label>
              <Input type="number" min={2} max={20} value={automod.spam.maxMessages}
                onChange={e => updateSpam({ maxMessages: +e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Within seconds</Label>
              <Input type="number" min={1} max={60} value={automod.spam.timeWindow}
                onChange={e => updateSpam({ timeWindow: +e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Timeout length (min)</Label>
              <Input type="number" min={1} max={1440} value={automod.spam.timeoutDuration}
                onChange={e => updateSpam({ timeoutDuration: +e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Strikes before timeout</Label>
              <Input type="number" min={1} max={10} value={automod.spam.violationThreshold}
                onChange={e => updateSpam({ violationThreshold: +e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anti-Raid</CardTitle>
          <CardDescription>Detects coordinated spam by tracking near-identical messages sent by multiple users at once. Noise tokens like [abc123] are stripped before comparison.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Users before trigger</Label>
              <Input type="number" min={2} max={50} value={automod.raid.userThreshold}
                onChange={e => updateRaid({ userThreshold: +e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Within seconds</Label>
              <Input type="number" min={1} max={120} value={automod.raid.timeWindow}
                onChange={e => updateRaid({ timeWindow: +e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message Limits</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Max @mentions per message</Label>
            <Input type="number" min={0} max={50} value={automod.maxMentions}
              onChange={e => update({ maxMentions: +e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Max lines per message</Label>
            <Input type="number" min={0} max={100} value={automod.maxLines}
              onChange={e => update({ maxLines: +e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exemptions</CardTitle>
          <CardDescription>These roles and channels are not affected by automod rules</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Exempt Roles</Label>
            <div className="flex flex-wrap gap-1">
              {automod.exemptRoles.map(id => {
                const role = guild.roles.find(r => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X className="h-3 w-3 cursor-pointer" onClick={() =>
                      update({ exemptRoles: automod.exemptRoles.filter(r => r !== id) })
                    } />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect roles={guild.roles.filter(r => !automod.exemptRoles.includes(r.id))}
              value={null}
              onChange={v => v && update({ exemptRoles: [...automod.exemptRoles, v] })}
              placeholder="Add exempt role..."
            />
          </div>
          <div className="space-y-2">
            <Label>Exempt Channels</Label>
            <div className="flex flex-wrap gap-1">
              {automod.exemptChannels.map(id => {
                const ch = guild.channels.find(c => c.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    #{ch?.name || id}
                    <X className="h-3 w-3 cursor-pointer" onClick={() =>
                      update({ exemptChannels: automod.exemptChannels.filter(c => c !== id) })
                    } />
                  </Badge>
                );
              })}
            </div>
            <ChannelSelect channels={guild.channels.filter(c => !automod.exemptChannels.includes(c.id))}
              value={null}
              onChange={v => v && update({ exemptChannels: [...automod.exemptChannels, v] })}
              placeholder="Add exempt channel..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed Links</CardTitle>
          <CardDescription>Websites that are allowed even when anti-link is on (one per line)</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            value={automod.allowedDomains.join('\n')}
            onChange={e => update({ allowedDomains: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
            placeholder="example.com&#10;youtube.com"
          />
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function WelcomeTab({ settings, guild, onSave, saving }: TabProps) {
  return <WelcomeEditor settings={settings} guild={guild} onSave={onSave} saving={saving} />;
}

function ModerationTab({ settings, guild, onSave, saving }: TabProps) {
  const [mod, setMod] = useState(settings.moderation);
  const [kwEnabled, setKwEnabled] = useState(settings.keywordWarnings?.enabled ?? false);
  const [kwAction, setKwAction] = useState(settings.keywordWarnings?.action ?? 'delete');
  const [kwKeywords, setKwKeywords] = useState(settings.keywordWarnings?.keywords ?? []);
  const [newKw, setNewKw] = useState('');
  const [slowmodeRoles, setSlowmodeRoles] = useState<string[]>(settings.slowmodeAllowedRoles || []);
  const [commandRoles, setCommandRoles] = useState<string[]>(settings.commandAllowedRoles || []);

  const handleSave = () => onSave({
    moderation: mod,
    keywordWarnings: { enabled: kwEnabled, action: kwAction, keywords: kwKeywords },
    slowmodeAllowedRoles: slowmodeRoles,
    commandAllowedRoles: commandRoles,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Moderation Basics</CardTitle>
          <CardDescription>Core settings for moderation commands</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Mute Role</Label>
              <RoleSelect roles={guild.roles} value={mod.muteRoleId} onChange={v => setMod(p => ({ ...p, muteRoleId: v }))} />
              <p className="text-xs text-gray-500">The role given to muted members (should have Send Messages denied)</p>
            </div>
            <div className="space-y-2">
              <Label>Mod Log Channel</Label>
              <ChannelSelect channels={guild.channels} value={mod.logChannelId} onChange={v => setMod(p => ({ ...p, logChannelId: v }))} />
              <p className="text-xs text-gray-500">Where ban/kick/warn actions are logged</p>
            </div>
          </div>
          <div className="space-y-2 max-w-xs">
            <Label>Mute Method</Label>
            <Select
              value={mod.muteMethod ?? 'auto'}
              onValueChange={(v) => setMod(p => ({ ...p, muteMethod: v as 'auto' | 'timeout' | 'mute_role' }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (role first, then timeout)</SelectItem>
                <SelectItem value="timeout">Timeout only</SelectItem>
                <SelectItem value="mute_role">Mute role only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">Choose how mute/unmute and warning auto-mute are applied.</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Auto-Mute on Warnings</p>
              <p className="text-xs text-gray-400">Automatically mute a member when they reach too many warnings</p>
            </div>
            <Switch checked={mod.autoMute} onCheckedChange={v => setMod(p => ({ ...p, autoMute: v }))} />
          </div>
          <div className="space-y-2 max-w-xs">
            <Label>Auto-Mute Threshold</Label>
            <Input
              type="number"
              min={1}
              max={20}
              disabled={!mod.autoMute}
              value={mod.autoMuteThreshold ?? 3}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value || '3', 10);
                const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 3;
                setMod(p => ({ ...p, autoMuteThreshold: clamped }));
              }}
            />
            <p className="text-xs text-gray-500">Mute users automatically when they reach this many warnings.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Blocked Words</CardTitle>
          <CardDescription>Automatically delete or warn when someone uses a blocked word</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Enabled</Label>
            <Switch checked={kwEnabled} onCheckedChange={setKwEnabled} />
          </div>
          {kwEnabled && (
            <>
              <div className="space-y-2">
                <Label>Action</Label>
                <Select value={kwAction} onValueChange={v => setKwAction(v as any)}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete">Delete</SelectItem>
                    <SelectItem value="warn">Warn</SelectItem>
                    <SelectItem value="delete+warn">Delete + Warn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Keywords</Label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {kwKeywords.map((kw, i) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      {kw.pattern}
                      <X className="h-3 w-3 cursor-pointer" onClick={() =>
                        setKwKeywords(prev => prev.filter((_, idx) => idx !== i))
                      } />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input value={newKw} onChange={e => setNewKw(e.target.value)} placeholder="Add keyword..."
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newKw.trim()) {
                        setKwKeywords(prev => [...prev, { pattern: newKw.trim(), isRegex: false, label: null, addedBy: null }]);
                        setNewKw('');
                      }
                    }} />
                  <Button size="sm" onClick={() => {
                    if (newKw.trim()) {
                      setKwKeywords(prev => [...prev, { pattern: newKw.trim(), isRegex: false, label: null, addedBy: null }]);
                      setNewKw('');
                    }
                  }}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Command Permissions</CardTitle>
          <CardDescription>Control which roles can use certain moderation commands</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Slowmode Allowed Roles</Label>
            <p className="text-xs text-gray-500">Roles that can use the slowmode command (staff role always has access)</p>
            <div className="flex flex-wrap gap-1">
              {slowmodeRoles.map(id => {
                const role = guild.roles.find(r => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X className="h-3 w-3 cursor-pointer" onClick={() =>
                      setSlowmodeRoles(prev => prev.filter(r => r !== id))
                    } />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect
              roles={guild.roles.filter(r => !slowmodeRoles.includes(r.id))}
              value={null}
              onChange={v => v && setSlowmodeRoles(prev => [...prev, v])}
              placeholder="Add role..."
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>Bot Command Allowed Roles</Label>
            <p className="text-xs text-gray-500">Extra roles that can use bot commands beyond the staff role</p>
            <div className="flex flex-wrap gap-1">
              {commandRoles.map(id => {
                const role = guild.roles.find(r => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X className="h-3 w-3 cursor-pointer" onClick={() =>
                      setCommandRoles(prev => prev.filter(r => r !== id))
                    } />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect
              roles={guild.roles.filter(r => !commandRoles.includes(r.id))}
              value={null}
              onChange={v => v && setCommandRoles(prev => [...prev, v])}
              placeholder="Add role..."
            />
          </div>
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

const COMMAND_MODULES = [
  { key: 'moderation', label: 'Moderation', desc: 'ban, kick, warn, mute, timeout, clear, slowmode' },
  { key: 'admin', label: 'Admin & Config', desc: 'automod, setlog, setprefix, welcome, ticket, lockdown, reaction roles' },
  { key: 'info', label: 'Info', desc: 'serverinfo, userinfo, roleinfo, botinfo, uptime' },
  { key: 'general', label: 'General', desc: 'help, ping, report, invite-me' },
];

const INDIVIDUAL_COMMANDS = [
  'ban', 'kick', 'warn', 'mute', 'unmute', 'timeout', 'clear', 'slowmode', 'massban',
  'lockdown', 'automod', 'welcome', 'goodbye', 'ticket', 'honeypot',
  'reactionrole', 'setlog', 'setserverlog', 'setprefix', 'clearprefix',
  'setstaff', 'autorole', 'roleall', 'roleclear', 'blacklist', 'keywords',
  'customcommand', 'commandperms', 'slowmodeperms', 'globalban',
  'help', 'ping', 'report', 'invite-me',
  'serverinfo', 'userinfo', 'botinfo', 'roleinfo', 'rolelist', 'inrole', 'uptime', 'warnings',
];

function CustomCommandsTab({ settings, onSave, saving }: TabProps) {
  const [commands, setCommands] = useState<CustomCommand[]>(settings.customCommands || []);
  const [disabled, setDisabled] = useState<string[]>(settings.disabledCommands || []);
  const [draft, setDraft] = useState<CustomCommand>({ name: '', response: '', embed: false, color: null, title: null });

  const addCommand = () => {
    if (!draft.name.trim() || !draft.response.trim()) return;
    setCommands(prev => [...prev, { ...draft, name: draft.name.toLowerCase().trim() }]);
    setDraft({ name: '', response: '', embed: false, color: null, title: null });
  };

  const removeCommand = (i: number) => setCommands(prev => prev.filter((_, idx) => idx !== i));

  const toggleDisabled = (name: string) => {
    setDisabled(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const handleSave = () => onSave({ customCommands: commands, disabledCommands: disabled });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Custom Commands</CardTitle>
          <CardDescription>Make your own commands that reply with a message or embed when someone types them</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {commands.map((cmd, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[hsl(var(--muted))]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono text-white">!{cmd.name}</p>
                <p className="text-xs text-gray-400 truncate">{cmd.response}</p>
              </div>
              {cmd.embed && <Badge variant="secondary">Embed</Badge>}
              <Button variant="ghost" size="icon" onClick={() => removeCommand(i)}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </div>
          ))}

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium text-white">Add Command</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} placeholder="Command name" />
              <div className="flex items-center gap-2">
                <Label className="text-xs">Send as embed?</Label>
                <Switch checked={draft.embed} onCheckedChange={v => setDraft(p => ({ ...p, embed: v }))} />
              </div>
            </div>
            <Textarea value={draft.response} onChange={e => setDraft(p => ({ ...p, response: e.target.value }))} placeholder="Response text..." rows={2} />
            {draft.embed && (
              <div className="grid grid-cols-2 gap-3">
                <Input value={draft.title || ''} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} placeholder="Embed title" />
                <Input value={draft.color || ''} onChange={e => setDraft(p => ({ ...p, color: e.target.value }))} placeholder="Color (#hex)" />
              </div>
            )}
            <Button size="sm" onClick={addCommand} disabled={!draft.name.trim() || !draft.response.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Add Command
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disable Modules</CardTitle>
          <CardDescription>Turn off entire command categories. All commands in a disabled module will stop working.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {COMMAND_MODULES.map(mod => (
            <div key={mod.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{mod.label}</p>
                <p className="text-xs text-gray-400">{mod.desc}</p>
              </div>
              <Switch
                checked={!disabled.includes(mod.key)}
                onCheckedChange={() => toggleDisabled(mod.key)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disable Individual Commands</CardTitle>
          <CardDescription>Turn off specific commands without disabling the whole module. Disabled commands are silently ignored.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {INDIVIDUAL_COMMANDS.map(cmd => (
              <Badge
                key={cmd}
                variant={disabled.includes(cmd) ? 'destructive' : 'secondary'}
                className="cursor-pointer select-none"
                onClick={() => toggleDisabled(cmd)}
              >
                {disabled.includes(cmd) ? '✕ ' : ''}{cmd}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">Click a command to toggle it. Red = disabled.</p>
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

interface TicketEntry {
  _id: string;
  ticketNumber: number;
  channelId: string;
  openedBy: string;
  claimedBy: string | null;
  claimedAt: string | null;
  subject: string | null;
  status: string;
  createdAt: string;
}

function TicketsTab({ settings, guild, onSave, saving }: TabProps) {
  const [categoryId, setCategoryId] = useState(settings.ticketCategoryId);
  const [supportRoleId, setSupportRoleId] = useState(settings.ticketSupportRoleId);
  const [supportRoleIds, setSupportRoleIds] = useState<string[]>(settings.ticketSupportRoleIds || []);
  const [logChannelId, setLogChannelId] = useState(settings.ticketLogChannelId);
  const [maxOpen, setMaxOpen] = useState(settings.ticketMaxOpen || 3);
  const [openMessage, setOpenMessage] = useState(settings.ticketOpenMessage || '');
  const [emoji, setEmoji] = useState(settings.ticketEmoji || '🎫');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [setupChannelId, setSetupChannelId] = useState<string | null>(null);

  const [tickets, setTickets] = useState<TicketEntry[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketFilter, setTicketFilter] = useState<'open' | 'closed'>('open');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTickets = useCallback(async (status: string) => {
    setTicketsLoading(true);
    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/tickets?status=${status}`, { credentials: 'include' });
      if (res.ok) setTickets(await res.json());
    } catch { } finally { setTicketsLoading(false); }
  }, [settings.guildId]);

  useEffect(() => { fetchTickets('open'); }, []);

  const handleClaim = async (ticketId: string) => {
    setActionLoading(ticketId);
    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/tickets/${ticketId}/claim`, {
        method: 'POST', credentials: 'include',
      });
      if (res.ok) fetchTickets(ticketFilter);
      else { const d = await res.json(); alert(d.error || 'Failed to claim'); }
    } catch { } finally { setActionLoading(null); }
  };

  const handleClose = async (ticketId: string) => {
    if (!confirm('Close this ticket? The channel will be deleted.')) return;
    setActionLoading(ticketId);
    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/tickets/${ticketId}/close`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Closed from dashboard' }),
      });
      if (res.ok) fetchTickets(ticketFilter);
    } catch { } finally { setActionLoading(null); }
  };

  const handleSave = () => onSave({
    ticketCategoryId: categoryId,
    ticketSupportRoleId: supportRoleId,
    ticketSupportRoleIds: supportRoleIds,
    ticketLogChannelId: logChannelId,
    ticketMaxOpen: maxOpen,
    ticketOpenMessage: openMessage || null,
    ticketEmoji: emoji,
  });

  const handleSetup = async (useExistingChannel: boolean) => {
    setSetupLoading(true);
    setSetupError(null);
    setSetupSuccess(null);
    try {
      const body: Record<string, string> = {};
      if (useExistingChannel && setupChannelId) body.channelId = setupChannelId;

      const res = await fetch(`/api/guilds/${settings.guildId}/ticket-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');

      setSetupSuccess(`Ticket panel created in #${data.channelName}!`);
      if (data.categoryId && !categoryId) setCategoryId(data.categoryId);
      setTimeout(() => setSetupSuccess(null), 5000);
    } catch (err: any) {
      setSetupError(err.message);
    } finally {
      setSetupLoading(false);
    }
  };

  const categories = guild.channels.filter(c => c.type === 4);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ticket Settings</CardTitle>
          <CardDescription>Let members open private support tickets that only they and staff can see</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Ticket Category</Label>
              <Select value={categoryId ?? '__none__'} onValueChange={v => setCategoryId(v === '__none__' ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">New tickets are created under this category</p>
            </div>
            <div className="space-y-2">
              <Label>Main Support Role</Label>
              <RoleSelect roles={guild.roles} value={supportRoleId} onChange={setSupportRoleId} />
              <p className="text-xs text-gray-500">This role can see and respond to all tickets</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Extra Support Roles</Label>
            <div className="flex flex-wrap gap-1 mb-2">
              {supportRoleIds.map(id => {
                const role = guild.roles.find(r => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X className="h-3 w-3 cursor-pointer" onClick={() =>
                      setSupportRoleIds(prev => prev.filter(r => r !== id))
                    } />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect
              roles={guild.roles.filter(r => !supportRoleIds.includes(r.id) && r.id !== supportRoleId)}
              value={null}
              onChange={v => v && setSupportRoleIds(prev => [...prev, v])}
              placeholder="Add support role..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Log Channel</Label>
              <ChannelSelect channels={guild.channels} value={logChannelId} onChange={setLogChannelId} />
              <p className="text-xs text-gray-500">Where ticket transcripts are sent</p>
            </div>
            <div className="space-y-2">
              <Label>Max Open Tickets</Label>
              <Input type="number" min={1} max={10} value={maxOpen} onChange={e => setMaxOpen(+e.target.value)} />
              <p className="text-xs text-gray-500">Per user</p>
            </div>
            <div className="space-y-2">
              <Label>Ticket Emoji</Label>
              <Input value={emoji} onChange={e => setEmoji(e.target.value)} />
              <p className="text-xs text-gray-500">Reaction on the panel</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Panel Message</Label>
            <Textarea value={openMessage} onChange={e => setOpenMessage(e.target.value)}
              placeholder="React below to open a support ticket..." rows={2} />
            <p className="text-xs text-gray-500">Text shown on the ticket panel. You can use: {'{user}'}, {'{server}'}, {'{ticket}'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ticket Panel Setup</CardTitle>
          <CardDescription>
            {settings.ticketSetupChannelId
              ? <>Panel is active in <strong>{channelName(guild.channels, settings.ticketSetupChannelId)}</strong>. You can create a new one to replace it.</>
              : 'Create a ticket panel so members can react to open tickets. This will create the category and channel automatically if needed.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => handleSetup(false)}
            disabled={setupLoading}
            className="w-full"
          >
            {setupLoading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Setting up...</>
            ) : (
              <><Plus className="h-4 w-4 mr-2" /> Create New Ticket Channel + Panel</>
            )}
          </Button>
          <p className="text-xs text-gray-500 text-center">Creates a "Tickets" category (if needed) and a #make-a-ticket channel with the panel</p>

          <Separator />

          <div className="space-y-2">
            <Label>Or post the panel in an existing channel:</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <ChannelSelect channels={guild.channels} value={setupChannelId} onChange={setSetupChannelId} placeholder="Pick a channel..." />
              </div>
              <Button
                onClick={() => handleSetup(true)}
                disabled={setupLoading || !setupChannelId}
                variant="outline"
                size="sm"
                className="shrink-0 self-start"
              >
                Post Panel
              </Button>
            </div>
          </div>

          {setupSuccess && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
              {setupSuccess}
            </div>
          )}
          {setupError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {setupError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manage Tickets</CardTitle>
          <CardDescription>View, claim, and close tickets from the dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button size="sm" variant={ticketFilter === 'open' ? 'default' : 'outline'}
              onClick={() => { setTicketFilter('open'); fetchTickets('open'); }}>
              Open
            </Button>
            <Button size="sm" variant={ticketFilter === 'closed' ? 'default' : 'outline'}
              onClick={() => { setTicketFilter('closed'); fetchTickets('closed'); }}>
              Closed
            </Button>
          </div>

          {ticketsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-gray-500">No {ticketFilter} tickets.</p>
          ) : (
            <div className="space-y-2">
              {tickets.map(t => (
                <div key={t._id} className="flex items-center gap-3 p-3 rounded-lg bg-[hsl(var(--muted))]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">Ticket #{t.ticketNumber}</p>
                      {t.claimedBy && <Badge variant="secondary" className="text-xs">Claimed</Badge>}
                    </div>
                    <p className="text-xs text-gray-400">
                      Opened by {t.openedBy}
                      {t.subject && <> · {t.subject}</>}
                      {t.claimedBy && <> · Claimed by {t.claimedBy}</>}
                      {' · '}{new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {t.status === 'open' && (
                    <div className="flex gap-1.5 shrink-0">
                      {!t.claimedBy && (
                        <Button size="sm" variant="outline"
                          disabled={actionLoading === t._id}
                          onClick={() => handleClaim(t._id)}>
                          {actionLoading === t._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Claim'}
                        </Button>
                      )}
                      <Button size="sm" variant="destructive"
                        disabled={actionLoading === t._id}
                        onClick={() => handleClose(t._id)}>
                        {actionLoading === t._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Close'}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function HoneypotTab({ settings, guild, onSave, saving }: TabProps) {
  const [channels, setChannels] = useState<HoneypotEntry[]>(settings.honeypotChannels || []);
  const [alertRoleId, setAlertRoleId] = useState(settings.honeypotAlertRoleId);
  const [newChannelId, setNewChannelId] = useState<string | null>(null);

  const addChannel = () => {
    if (!newChannelId) return;
    if (channels.some(c => c.channelId === newChannelId)) return;
    setChannels(prev => [...prev, {
      channelId: newChannelId,
      action: 'ban',
      enabled: true,
      banDeleteDays: 1,
      timeoutHours: 24,
      roleId: null,
    }]);
    setNewChannelId(null);
  };

  const updateChannel = (i: number, patch: Partial<HoneypotEntry>) =>
    setChannels(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));

  const removeChannel = (i: number) => setChannels(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = () => onSave({ honeypotChannels: channels, honeypotAlertRoleId: alertRoleId });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Honeypot Channels</CardTitle>
          <CardDescription>Trap channels that catch raiders and bots. Anyone who sends a message in these channels gets punished automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Alert Role</Label>
            <RoleSelect roles={guild.roles} value={alertRoleId} onChange={setAlertRoleId} placeholder="Role to notify" />
            <p className="text-xs text-gray-500">This role gets pinged when someone falls for a honeypot</p>
          </div>

          {channels.map((ch, i) => {
            return (
              <div key={i} className="p-3 rounded-lg bg-[hsl(var(--muted))] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={ch.enabled ? 'default' : 'outline'}>
                      {channelName(guild.channels, ch.channelId)}
                    </Badge>
                    <Switch checked={ch.enabled} onCheckedChange={v => updateChannel(i, { enabled: v })} />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeChannel(i)}>
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Action</Label>
                    <Select value={ch.action} onValueChange={v => updateChannel(i, { action: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ban">Ban</SelectItem>
                        <SelectItem value="kick">Kick</SelectItem>
                        <SelectItem value="timeout">Timeout</SelectItem>
                        <SelectItem value="role">Add Role</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {ch.action === 'timeout' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Timeout Hours</Label>
                      <Input type="number" min={1} max={672} value={ch.timeoutHours}
                        onChange={e => updateChannel(i, { timeoutHours: +e.target.value })} />
                    </div>
                  )}
                  {ch.action === 'ban' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Delete Days</Label>
                      <Input type="number" min={0} max={7} value={ch.banDeleteDays}
                        onChange={e => updateChannel(i, { banDeleteDays: +e.target.value })} />
                    </div>
                  )}
                  {ch.action === 'role' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Role to Add</Label>
                      <RoleSelect roles={guild.roles} value={ch.roleId} onChange={v => updateChannel(i, { roleId: v })} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex gap-2">
            <div className="flex-1">
              <ChannelSelect channels={guild.channels.filter(c => !channels.some(h => h.channelId === c.id))}
                value={newChannelId} onChange={setNewChannelId} placeholder="Add honeypot channel..." />
            </div>
            <Button size="sm" onClick={addChannel} disabled={!newChannelId}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function VerificationTab({ settings, guild, onSave, saving }: TabProps) {
  const v = settings.verification || {} as any;
  const [enabled, setEnabled] = useState(v.enabled ?? false);
  const [verifiedRoleId, setVerifiedRoleId] = useState(v.verifiedRoleId);
  const [categoryId, setCategoryId] = useState(v.categoryId);
  const [logChannelId, setLogChannelId] = useState(v.logChannelId);
  const [panelChannelId, setPanelChannelId] = useState(v.panelChannelId);
  const [panelMessageId, setPanelMessageId] = useState(v.panelMessageId);
  const [maxAttempts, setMaxAttempts] = useState(v.maxAttempts ?? 2);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<string | null>(null);

  const handleSave = () => onSave({
    verification: {
      enabled,
      verifiedRoleId,
      categoryId,
      logChannelId,
      panelChannelId,
      panelMessageId,
      maxAttempts,
    },
  } as any);

  const handleSetup = async () => {
    setSetupLoading(true);
    setSetupResult(null);
    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/verification-setup`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifiedRoleId }),
      });
      const data = await res.json();
      if (res.ok) {
        setSetupResult('✅ Setup complete! Category, channel, and panel created.');
        setEnabled(true);
        setCategoryId(data.categoryId);
        setVerifiedRoleId(data.verifiedRoleId);
        setPanelChannelId(data.panelChannelId);
        setPanelMessageId(data.panelMessageId);
      } else {
        setSetupResult(`❌ ${data.error || 'Setup failed'}`);
      }
    } catch (err: any) {
      setSetupResult(`❌ ${err.message}`);
    } finally {
      setSetupLoading(false);
    }
  };

  const categories = guild.channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Manual Verification</CardTitle>
          <CardDescription>Require new members to solve a captcha before gaining access to the server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm space-y-1">
            <p className="font-medium text-blue-400">How Verification Works</p>
            <p className="text-gray-400">1. A panel with a ✅ reaction is posted in a channel visible to unverified users.</p>
            <p className="text-gray-400">2. When a user reacts, a private channel is created with a captcha image.</p>
            <p className="text-gray-400">3. The user types the 6-letter code to get the Verified role.</p>
            <p className="text-gray-400 mt-2"><strong>Prerequisites:</strong> Fluxy needs <strong>Manage Channels</strong>, <strong>Manage Roles</strong>, and <strong>Add Reactions</strong> permissions. The Verified role must be below Fluxy's role in the hierarchy.</p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Verification</Label>
              <p className="text-sm text-muted-foreground">When enabled, users react to a panel to start a captcha challenge.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Verified Role</Label>
              <RoleSelect roles={guild.roles} value={verifiedRoleId} onChange={setVerifiedRoleId} placeholder="Select verified role" />
              <p className="text-xs text-muted-foreground mt-1">The role granted after passing verification. Deny @everyone View Channel on your server channels and allow this role to see them.</p>
            </div>
            <div>
              <Label>Verification Category</Label>
              <Select value={categoryId || ''} onValueChange={(val: string) => setCategoryId(val || null)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Private captcha channels are created here.</p>
            </div>
            <div>
              <Label>Panel Channel</Label>
              <ChannelSelect channels={guild.channels} value={panelChannelId} onChange={setPanelChannelId} placeholder="Channel for the verification panel" />
              <p className="text-xs text-muted-foreground mt-1">Where the ✅ reaction panel is posted. Should be visible to unverified users.</p>
            </div>
            <div>
              <Label>Log Channel</Label>
              <ChannelSelect channels={guild.channels} value={logChannelId} onChange={setLogChannelId} placeholder="Optional log channel" />
            </div>
            <div>
              <Label>Max Attempts</Label>
              <Input type="number" min={1} max={5} value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground mt-1">How many tries before the user is kicked from the channel.</p>
            </div>
          </div>

          <Separator />

          <div>
            <Label>Quick Setup</Label>
            <p className="text-sm text-muted-foreground mb-2">Auto-create a Verification category, #verify-here channel, Verified role, and post the panel. Use this if you're setting up for the first time.</p>
            <Button onClick={handleSetup} disabled={setupLoading} variant="outline">
              {setupLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…</> : 'Run Setup'}
            </Button>
            {setupResult && <p className="text-sm mt-2">{setupResult}</p>}
          </div>

          {panelChannelId && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm">
              <span>
                <strong>Panel active</strong> in <code>{channelName(guild.channels, panelChannelId)}</code>
                {panelMessageId && <span className="text-xs text-gray-500 ml-2">msg: {panelMessageId}</span>}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSetup}
                  disabled={setupLoading}
                >
                  Re-post Panel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300"
                  onClick={() => {
                    setPanelChannelId(null);
                    setPanelMessageId(null);
                  }}
                >
                  Remove Panel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function ReactionRolesTab({ settings, guild, onSave, saving: _saving, guildId, refetchSettings }: TabProps) {
  const [dmEnabled, setDmEnabled] = useState(settings.reactionRoleDMEnabled ?? false);
  const [panels, setPanels] = useState(() =>
    (settings.reactionRoles || []).map(p => ({ ...p, roles: [...p.roles.map(r => ({ ...r }))] }))
  );
  const [creating, setCreating] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [newChannelId, setNewChannelId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('React below to get a role.');

  const [addPanelIdx, setAddPanelIdx] = useState<number | null>(null);
  const [addRoleId, setAddRoleId] = useState<string | null>(null);
  const [addEmoji, setAddEmoji] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const serverEmojis = guild.emojis || [];

  const persistReactionState = async (nextPanels: any[], nextDmEnabled: boolean) => {
    setCreating(true);
    setAddError(null);
    try {
      await Promise.resolve(onSave({ reactionRoleDMEnabled: nextDmEnabled, reactionRoles: nextPanels }));
    } catch (err: any) {
      setAddError(err?.message || 'Failed to save reaction role changes');
    } finally {
      setCreating(false);
    }
  };

  const removePanel = async (idx: number) => {
    const nextPanels = panels.filter((_, i) => i !== idx);
    setPanels(nextPanels);
    await persistReactionState(nextPanels, dmEnabled);
  };

  const removeMapping = async (panelIdx: number, mappingIdx: number) => {
    const nextPanels = panels.map((p, i) =>
      i === panelIdx ? { ...p, roles: p.roles.filter((_, j) => j !== mappingIdx) } : p
    );
    setPanels(nextPanels);
    await persistReactionState(nextPanels, dmEnabled);
  };

  const createPanel = async () => {
    if (!guildId || !newChannelId) return;
    setCreating(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/reaction-roles/panels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          channelId: newChannelId,
          title: newTitle.trim() || undefined,
          description: newDescription.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPanels(prev => [...prev, { messageId: data.messageId, channelId: data.channelId, roles: [] }]);
      setNewChannelId(null);
      setNewTitle('');
      setNewDescription('React below to get a role.');
      refetchSettings?.();
    } catch (err: any) {
      setAddError(err.message || 'Failed to create panel');
    } finally {
      setCreating(false);
    }
  };

  const addMapping = async (panel: { messageId: string; channelId: string; roles: Array<{ emoji: string; roleId: string }> }) => {
    if (!guildId || !addRoleId || !addEmoji.trim()) return;
    if (panel.roles.length >= 20) {
      setAddError('Panel has maximum 20 mappings');
      return;
    }
    setCreating(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/reaction-roles/panels/${panel.messageId}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emoji: addEmoji.trim(), roleId: addRoleId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPanels(prev => prev.map(p =>
        p.messageId === panel.messageId
          ? { ...p, roles: [...p.roles, { emoji: data.emoji, roleId: data.roleId }] }
          : p
      ));
      setAddPanelIdx(null);
      setAddRoleId(null);
      setAddEmoji('');
      setEmojiPickerOpen(false);
      refetchSettings?.();
    } catch (err: any) {
      setAddError(err.message || 'Failed to add mapping');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Reaction Role Settings</CardTitle>
          <CardDescription>Control how reaction roles behave across the server</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">DM on Role Change</p>
              <p className="text-xs text-gray-400">Send a private message to users when they get or lose a role from reacting</p>
            </div>
            <Switch
              checked={dmEnabled}
              onCheckedChange={(v) => {
                setDmEnabled(v);
                void persistReactionState(panels, v);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create New Panel</CardTitle>
          <CardDescription>
            Create a reaction role panel directly from the dashboard. Select a channel, optional title and description, then add emoji-role mappings below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <ChannelSelect
                channels={guild.channels}
                value={newChannelId}
                onChange={setNewChannelId}
                placeholder="Select channel for panel..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Title (optional)</Label>
              <Input
                placeholder="Reaction Roles"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                className="bg-[hsl(var(--muted))]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="React below to get a role."
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              className="bg-[hsl(var(--muted))] min-h-[60px]"
            />
          </div>
          <Button onClick={createPanel} disabled={!newChannelId || creating}>
            {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</> : <><Plus className="h-4 w-4 mr-2" /> Create Panel</>}
          </Button>
          {addError && <p className="text-sm text-red-400">{addError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Panels</CardTitle>
          <CardDescription>
            Your reaction role panels. Add mappings with an emoji and a role. Custom server emojis are listed first below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {panels.length === 0 ? (
            <p className="text-sm text-gray-500">No panels yet. Create one above or use <code className="text-xs bg-[hsl(var(--muted))] px-1 py-0.5 rounded">!rr post #channel</code> in your server.</p>
          ) : (
            panels.map((panel, i) => {
              const ch = guild.channels.find(c => c.id === panel.channelId);
              const isAdding = addPanelIdx === i;
              return (
                <div key={i} className="p-3 rounded-lg bg-[hsl(var(--muted))] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">#{ch?.name || panel.channelId}</Badge>
                      <span className="text-xs text-gray-400 font-mono">msg: {panel.messageId}</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-400" onClick={() => void removePanel(i)} disabled={creating}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {panel.roles.map((rr, j) => {
                      const role = guild.roles.find(r => r.id === rr.roleId);
                      const removeRole = rr.removeRoleId ? guild.roles.find(r => r.id === rr.removeRoleId) : null;
                      return (
                        <div key={j} className="group flex items-center gap-1 text-xs bg-[hsl(var(--background))] px-2 py-1 rounded">
                          <span>{rr.emoji}</span>
                          <span className="text-gray-300">→</span>
                          {removeRole ? (
                            <>
                              <span className="text-red-400">−{roleName(removeRole.name)}</span>
                              <span className="text-green-400">+{roleName(role?.name || rr.roleId)}</span>
                            </>
                          ) : (
                            <span className="text-white">{roleName(role?.name || rr.roleId)}</span>
                          )}
                          <button className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-400 disabled:opacity-40" onClick={() => void removeMapping(i, j)} disabled={creating}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    {panel.roles.length < 20 && (
                      isAdding ? (
                        <div className="w-full space-y-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5">
                          <div className="flex items-center gap-2 text-xs text-gray-300">
                            <Smile className="h-3.5 w-3.5" />
                            <span>Pick an emoji or paste one manually</span>
                          </div>
                          {serverEmojis.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[11px] text-gray-400">Server emojis (click to use)</p>
                              <div className="max-h-24 overflow-y-auto rounded border border-[hsl(var(--border))] p-1.5">
                                <div className="flex flex-wrap gap-1.5">
                                  {serverEmojis.map((emoji) => {
                                    const value = emoji.animated
                                      ? `a:${emoji.name}:${emoji.id}`
                                      : `${emoji.name}:${emoji.id}`;
                                    const builtSpriteUrl = `https://fluxerusercontent.com/emojis/${emoji.id}.webp?animated=${emoji.animated ? 'true' : 'false'}&size=32&quality=lossless`;
                                    const spriteUrl = typeof emoji.url === 'string' ? emoji.url : builtSpriteUrl;
                                    return (
                                      <button
                                        key={emoji.id}
                                        type="button"
                                        className={`rounded border px-2 py-1 text-xs transition-colors inline-flex items-center gap-1.5 ${
                                          addEmoji === value
                                            ? 'border-blue-400 bg-blue-500/20'
                                            : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                                        }`}
                                        onClick={() => setAddEmoji(value)}
                                        title={value}
                                      >
                                        <img
                                          src={spriteUrl}
                                          alt={emoji.name}
                                          className="h-4 w-4 rounded-sm"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                        <span>{emoji.name}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                          {emojiPickerOpen && (
                            <div className="rounded-md border border-[hsl(var(--border))] overflow-hidden">
                              <EmojiPicker
                                onEmojiClick={(emojiData: EmojiClickData) => {
                                  setAddEmoji(emojiData.emoji);
                                  setEmojiPickerOpen(false);
                                }}
                                searchDisabled={false}
                                skinTonesDisabled={false}
                                lazyLoadEmojis={true}
                                previewConfig={{ showPreview: false }}
                                theme={Theme.DARK}
                                width="100%"
                                height={320}
                              />
                            </div>
                          )}
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEmojiPickerOpen(v => !v)}
                            >
                              <Smile className="h-3.5 w-3.5 mr-1" />
                              {emojiPickerOpen ? 'Close Picker' : 'Open Emoji Picker'}
                            </Button>
                            <Input
                              placeholder="Emoji or custom name:id"
                              value={addEmoji}
                              onChange={e => setAddEmoji(e.target.value)}
                              className="w-52 h-8 text-xs"
                            />
                            <RoleSelect
                              roles={guild.roles}
                              value={addRoleId}
                              onChange={setAddRoleId}
                              placeholder="Role"
                            />
                            <Button size="sm" onClick={() => addMapping(panel)} disabled={!addRoleId || !addEmoji.trim() || creating}>
                              <Plus className="h-3 w-3 mr-1" /> Add mapping
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setAddPanelIdx(null); setAddRoleId(null); setAddEmoji(''); setAddError(null); }}>
                              Cancel
                            </Button>
                          </div>
                          <p className="text-[11px] text-gray-400">
                            Custom emoji format: <code className="text-[10px] bg-[hsl(var(--muted))] px-0.5 rounded">name:id</code>. Unicode emojis can be selected from the picker.
                          </p>
                        </div>
                      ) : (
                        <button
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                          onClick={() => setAddPanelIdx(i)}
                        >
                          <Plus className="h-3 w-3" /> Add mapping
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LockdownTab({ settings, guild, onSave, saving }: TabProps) {
  const [lockdownRoles, setLockdownRoles] = useState<string[]>(settings.lockdownRoles || []);
  const [allowedRoles, setAllowedRoles] = useState<string[]>(settings.lockdownAllowedRoles || []);
  const [allowedUsers, setAllowedUsers] = useState<string[]>(settings.lockdownAllowedUsers || []);
  const [newUserId, setNewUserId] = useState('');

  const handleSave = () => onSave({
    lockdownRoles,
    lockdownAllowedRoles: allowedRoles,
    lockdownAllowedUsers: allowedUsers,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Roles to Lock</CardTitle>
          <CardDescription>These roles lose their ability to send messages when you run <code className="text-xs bg-[hsl(var(--muted))] px-1 py-0.5 rounded">!lockdown</code> (in addition to @everyone)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {lockdownRoles.map(id => {
              const role = guild.roles.find(r => r.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  {roleName(role?.name || id)}
                  <X className="h-3 w-3 cursor-pointer" onClick={() =>
                    setLockdownRoles(prev => prev.filter(r => r !== id))
                  } />
                </Badge>
              );
            })}
          </div>
          <RoleSelect
            roles={guild.roles.filter(r => !lockdownRoles.includes(r.id))}
            value={null}
            onChange={v => v && setLockdownRoles(prev => [...prev, v])}
            placeholder="Add lockdown role..."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who Can Lock Down</CardTitle>
          <CardDescription>Roles that are allowed to run the lockdown command</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {allowedRoles.map(id => {
              const role = guild.roles.find(r => r.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  {roleName(role?.name || id)}
                  <X className="h-3 w-3 cursor-pointer" onClick={() =>
                    setAllowedRoles(prev => prev.filter(r => r !== id))
                  } />
                </Badge>
              );
            })}
          </div>
          <RoleSelect
            roles={guild.roles.filter(r => !allowedRoles.includes(r.id))}
            value={null}
            onChange={v => v && setAllowedRoles(prev => [...prev, v])}
            placeholder="Add allowed role..."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed Users</CardTitle>
          <CardDescription>Specific users who can run the lockdown command (paste their user ID)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {allowedUsers.map(id => (
              <Badge key={id} variant="secondary" className="gap-1 font-mono">
                {id}
                <X className="h-3 w-3 cursor-pointer" onClick={() =>
                  setAllowedUsers(prev => prev.filter(u => u !== id))
                } />
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newUserId}
              onChange={e => setNewUserId(e.target.value)}
              placeholder="User ID (e.g. 123456789012345678)"
              onKeyDown={e => {
                if (e.key === 'Enter' && /^\d{17,20}$/.test(newUserId.trim())) {
                  setAllowedUsers(prev => prev.includes(newUserId.trim()) ? prev : [...prev, newUserId.trim()]);
                  setNewUserId('');
                }
              }}
            />
            <Button size="sm" onClick={() => {
              if (/^\d{17,20}$/.test(newUserId.trim())) {
                setAllowedUsers(prev => prev.includes(newUserId.trim()) ? prev : [...prev, newUserId.trim()]);
                setNewUserId('');
              }
            }}><Plus className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function GoodbyeTab({ settings, guild, onSave, saving }: TabProps) {
  const [goodbye, setGoodbye] = useState(settings.goodbyeMessage);

  const update = (patch: Partial<typeof goodbye>) => setGoodbye(prev => ({ ...prev, ...patch }));
  const updateEmbed = (patch: Partial<typeof goodbye.embed>) =>
    setGoodbye(prev => ({ ...prev, embed: { ...prev.embed, ...patch } }));

  const handleSave = () => onSave({ goodbyeMessage: goodbye });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserMinus className="h-4 w-4" /> Goodbye Message</CardTitle>
          <CardDescription>Send a message when a member leaves your server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Enabled</p>
              <p className="text-xs text-gray-400">Post a message when someone leaves the server</p>
            </div>
            <Switch checked={goodbye.enabled} onCheckedChange={v => update({ enabled: v })} />
          </div>

          {goodbye.enabled && (
            <>
              <Separator />

              <div className="space-y-2">
                <Label>Goodbye Channel</Label>
                <ChannelSelect channels={guild.channels} value={goodbye.channelId} onChange={v => update({ channelId: v })} />
                <p className="text-xs text-gray-500">Where the goodbye message is sent</p>
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea value={goodbye.message || ''} onChange={e => update({ message: e.target.value })}
                  placeholder="Goodbye {user}, we'll miss you!" rows={3} />
                <p className="text-xs text-gray-500">Variables: {'{user}'} {'{username}'} {'{server}'} {'{count}'}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {goodbye.enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Goodbye Embed</CardTitle>
            <CardDescription>Add a rich embed box below the goodbye message</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Enabled</p>
                <p className="text-xs text-gray-400">Show an embed alongside the goodbye text</p>
              </div>
              <Switch checked={goodbye.embed.enabled} onCheckedChange={v => updateEmbed({ enabled: v })} />
            </div>
            {goodbye.embed.enabled && (
              <>
                <Separator />
                {/* Embed preview bar */}
                <div className="rounded-lg overflow-hidden border border-white/10">
                  <div className="flex">
                    <div className="w-1 shrink-0" style={{ backgroundColor: goodbye.embed.color || '#5865F2' }} />
                    <div className="p-4 space-y-2 flex-1 bg-[hsl(var(--muted))]">
                      {goodbye.embed.title && (
                        <p className="text-sm font-semibold text-white">{goodbye.embed.title}</p>
                      )}
                      {goodbye.embed.description && (
                        <p className="text-xs text-gray-300">{goodbye.embed.description}</p>
                      )}
                      {goodbye.embed.footer && (
                        <p className="text-[10px] text-gray-500 pt-1 border-t border-white/5">{goodbye.embed.footer}</p>
                      )}
                      {!goodbye.embed.title && !goodbye.embed.description && (
                        <p className="text-xs text-gray-500 italic">Preview will appear here...</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input value={goodbye.embed.title || ''} onChange={e => updateEmbed({ title: e.target.value })} placeholder="Embed title" />
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Color</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={goodbye.embed.color || '#5865F2'}
                          onChange={e => updateEmbed({ color: e.target.value })}
                          className="h-9 w-9 rounded border border-white/10 bg-transparent cursor-pointer shrink-0"
                        />
                        <Input value={goodbye.embed.color || ''} onChange={e => updateEmbed({ color: e.target.value })} placeholder="#5865F2" className="font-mono text-xs" />
                      </div>
                    </div>
                  </div>
                </div>
                <Textarea value={goodbye.embed.description || ''} onChange={e => updateEmbed({ description: e.target.value })} placeholder="Embed description - supports {user}, {server}, {count}" rows={3} />
                <Input value={goodbye.embed.footer || ''} onChange={e => updateEmbed({ footer: e.target.value })} placeholder="Footer text" />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function StarboardTab({ settings, guild, onSave, saving, guildId }: TabProps) {
  const [sb, setSb] = useState<Starboard>(settings.starboard);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [stats, setStats] = useState<{ totalEntries: number; totalStars: number; postedCount: number } | null>(null);

  const update = (patch: Partial<Starboard>) => setSb(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    if (guildId) {
      api.get<any[]>(`/guilds/${guildId}/starboard/leaderboard`, { skipCache: true }).then(setLeaderboard).catch(() => {});
      api.get<any>(`/guilds/${guildId}/starboard/stats`, { skipCache: true }).then(setStats).catch(() => {});
    }
  }, [guildId]);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    update({ emoji: emojiData.emoji });
    setShowEmojiPicker(false);
  };

  const handleSave = () => onSave({ starboard: sb });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Star className="h-4 w-4" /> Starboard</CardTitle>
          <CardDescription>Highlight popular messages by automatically reposting them when they receive enough reactions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Enabled</p>
              <p className="text-xs text-gray-400">Turn the starboard system on or off</p>
            </div>
            <Switch checked={sb.enabled} onCheckedChange={v => update({ enabled: v })} />
          </div>

          {sb.enabled && (
            <>
              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Starboard Channel</Label>
                  <ChannelSelect channels={guild.channels} value={sb.channelId} onChange={v => update({ channelId: v })} placeholder="Select starboard channel" />
                  <p className="text-xs text-gray-500">Where starred messages will be reposted</p>
                </div>
                <div className="space-y-2">
                  <Label>Threshold</Label>
                  <Input type="number" min={1} max={100} value={sb.threshold}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) update({ threshold: Math.max(1, Math.min(100, v)) });
                    }} />
                  <p className="text-xs text-gray-500">Minimum reactions before a message is posted to the starboard</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tracked Emoji</Label>
                <div className="flex items-center gap-3">
                  <div className="text-2xl px-3 py-1 rounded-lg bg-[hsl(var(--muted))] border border-white/10">
                    {sb.emoji}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                    <Smile className="h-4 w-4 mr-1" /> Change Emoji
                  </Button>
                </div>
                {showEmojiPicker && (
                  <div className="mt-2">
                    <EmojiPicker theme={Theme.DARK} onEmojiClick={handleEmojiClick} lazyLoadEmojis />
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {sb.enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Behavior</CardTitle>
              <CardDescription>Control how the starboard handles different scenarios</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Allow Self-Starring</p>
                  <p className="text-xs text-gray-400">Let users star their own messages</p>
                </div>
                <Switch checked={sb.selfStarEnabled} onCheckedChange={v => update({ selfStarEnabled: v })} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Ignore Bot Messages</p>
                  <p className="text-xs text-gray-400">Don't track stars on messages sent by bots</p>
                </div>
                <Switch checked={sb.ignoreBots} onCheckedChange={v => update({ ignoreBots: v })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exclusions</CardTitle>
              <CardDescription>Channels and roles that are excluded from the starboard</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Ignored Channels</Label>
                <p className="text-xs text-gray-500">Messages in these channels won't be tracked</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {sb.ignoredChannels.map(id => {
                    const ch = guild.channels.find(c => c.id === id);
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        #{ch?.name || id}
                        <X className="h-3 w-3 cursor-pointer" onClick={() =>
                          update({ ignoredChannels: sb.ignoredChannels.filter(c => c !== id) })
                        } />
                      </Badge>
                    );
                  })}
                </div>
                <ChannelSelect
                  channels={guild.channels.filter(c => !sb.ignoredChannels.includes(c.id))}
                  value={null}
                  onChange={v => v && update({ ignoredChannels: [...sb.ignoredChannels, v] })}
                  placeholder="Add ignored channel..."
                />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Ignored Roles</Label>
                <p className="text-xs text-gray-500">Members with these roles can't contribute stars</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {sb.ignoredRoles.map(id => {
                    const role = guild.roles.find(r => r.id === id);
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        @{role?.name || id}
                        <X className="h-3 w-3 cursor-pointer" onClick={() =>
                          update({ ignoredRoles: sb.ignoredRoles.filter(r => r !== id) })
                        } />
                      </Badge>
                    );
                  })}
                </div>
                <RoleSelect
                  roles={guild.roles.filter(r => !sb.ignoredRoles.includes(r.id))}
                  value={null}
                  onChange={v => v && update({ ignoredRoles: [...sb.ignoredRoles, v] })}
                  placeholder="Add ignored role..."
                />
              </div>
            </CardContent>
          </Card>

          {stats && (
            <Card>
              <CardHeader>
                <CardTitle>Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 rounded-lg bg-[hsl(var(--muted))]">
                    <p className="text-2xl font-bold text-white">{stats.totalEntries}</p>
                    <p className="text-xs text-gray-400">Tracked Messages</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-[hsl(var(--muted))]">
                    <p className="text-2xl font-bold text-yellow-400">{stats.totalStars}</p>
                    <p className="text-xs text-gray-400">Total Stars</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-[hsl(var(--muted))]">
                    <p className="text-2xl font-bold text-white">{stats.postedCount}</p>
                    <p className="text-xs text-gray-400">Posted</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {leaderboard.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Leaderboard</CardTitle>
                <CardDescription>Top starred messages in this server</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {leaderboard.map((entry: any, i: number) => (
                  <div key={entry.messageId} className="flex items-center gap-3 p-3 rounded-lg bg-[hsl(var(--muted))]">
                    <span className="text-lg font-bold text-gray-400 w-6">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-400">
                          {entry.starCount >= 25 ? '💫' : entry.starCount >= 10 ? '🌟' : '⭐'}
                        </span>
                        <span className="text-sm font-medium text-white">{entry.starCount} stars</span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        by &lt;@{entry.authorId}&gt; in #{guild.channels.find(c => c.id === entry.channelId)?.name || entry.channelId}
                      </p>
                    </div>
                    <a
                      href={`https://fluxer.app/channels/${guildId}/${entry.channelId}/${entry.messageId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
                    >
                      Jump →
                    </a>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

interface TabProps {
  settings: GuildSettingsType;
  guild: GuildDetail;
  onSave: (patch: Partial<GuildSettingsType>) => void;
  saving?: boolean;
  guildId?: string;
  refetchSettings?: () => void;
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving?: boolean }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onClick} disabled={saving}>
        {saving ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
        ) : (
          <><Save className="h-4 w-4 mr-2" /> Save Changes</>
        )}
      </Button>
    </div>
  );
}

export function GuildSettings() {
  const { guildId } = useParams<{ guildId: string }>();
  const { guild, settings, loading, saving, error, saveError, updateSettings, refetchSettings } = useGuildData(guildId);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = useCallback(async (patch: Partial<GuildSettingsType>) => {
    setSaveSuccess(false);
    try {
      await updateSettings(patch);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
    }
  }, [updateSettings]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !guild || !settings) {
    return (
      <div className="space-y-4">
        <Link to="/guilds" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to servers
        </Link>
        <div className="text-red-400">Failed to load guild: {error || 'Not found'}</div>
      </div>
    );
  }

  const tabProps: TabProps = { settings, guild, onSave: handleSave, saving, guildId: guildId ?? undefined, refetchSettings };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Link to="/guilds" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold shrink-0">
            {guild.icon ? (
              <img src={`https://fluxerusercontent.com/icons/${guild.id}/${guild.icon}.png?size=64`}
                alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : guild.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{guild.name}</h1>
          </div>
        </div>
        {saving && (
          <div className="flex items-center gap-2 text-blue-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Saving...
          </div>
        )}
        {saveSuccess && <Badge className="bg-green-600">Saved!</Badge>}
        {saveError && <Badge variant="destructive">{saveError}</Badge>}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="flex flex-wrap gap-1 h-auto p-1">
          <TabsTrigger value="general" className="gap-1.5"><Settings className="h-3.5 w-3.5" />General</TabsTrigger>
          <TabsTrigger value="automod" className="gap-1.5"><Shield className="h-3.5 w-3.5" />Automod</TabsTrigger>
          <TabsTrigger value="welcome" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Welcome</TabsTrigger>
          <TabsTrigger value="moderation" className="gap-1.5"><Gavel className="h-3.5 w-3.5" />Moderation</TabsTrigger>
          <TabsTrigger value="commands" className="gap-1.5"><Terminal className="h-3.5 w-3.5" />Commands</TabsTrigger>
          <TabsTrigger value="tickets" className="gap-1.5"><Ticket className="h-3.5 w-3.5" />Tickets</TabsTrigger>
          <TabsTrigger value="reactionroles" className="gap-1.5"><Smile className="h-3.5 w-3.5" />Reaction Roles</TabsTrigger>
          <TabsTrigger value="lockdown" className="gap-1.5"><Lock className="h-3.5 w-3.5" />Lockdown</TabsTrigger>
          <TabsTrigger value="goodbye" className="gap-1.5"><UserMinus className="h-3.5 w-3.5" />Goodbye</TabsTrigger>
          <TabsTrigger value="honeypot" className="gap-1.5"><Bug className="h-3.5 w-3.5" />Honeypot</TabsTrigger>
          <TabsTrigger value="verification" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />Verification</TabsTrigger>
          <TabsTrigger value="starboard" className="gap-1.5"><Star className="h-3.5 w-3.5" />Starboard</TabsTrigger>
        </TabsList>

        <TabsContent value="general"><GeneralTab {...tabProps} /></TabsContent>
        <TabsContent value="automod"><AutomodTab {...tabProps} /></TabsContent>
        <TabsContent value="welcome"><WelcomeTab {...tabProps} /></TabsContent>
        <TabsContent value="moderation"><ModerationTab {...tabProps} /></TabsContent>
        <TabsContent value="commands"><CustomCommandsTab {...tabProps} /></TabsContent>
        <TabsContent value="tickets"><TicketsTab {...tabProps} /></TabsContent>
        <TabsContent value="reactionroles"><ReactionRolesTab {...tabProps} /></TabsContent>
        <TabsContent value="lockdown"><LockdownTab {...tabProps} /></TabsContent>
        <TabsContent value="goodbye"><GoodbyeTab {...tabProps} /></TabsContent>
        <TabsContent value="honeypot"><HoneypotTab {...tabProps} /></TabsContent>
        <TabsContent value="verification"><VerificationTab {...tabProps} /></TabsContent>
        <TabsContent value="starboard"><StarboardTab {...tabProps} /></TabsContent>
      </Tabs>
    </div>
  );
}
