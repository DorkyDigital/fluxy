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
import { useState, useCallback, useEffect, useRef } from 'react';
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react';
import {
  ArrowLeft,
  Settings,
  Shield,
  MessageSquare,
  Gavel,
  Terminal,
  Ticket,
  Bug,
  Save,
  Loader2,
  Plus,
  Trash2,
  X,
  Lock,
  Smile,
  UserMinus,
  ShieldCheck,
  Star,
  Rss,
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
import { buildRssSavePayload } from '../lib/rssSettings';
import {
  buildCustomCommandsSavePayload,
  createCustomCommandDraft,
  CUSTOM_COMMAND_MAX_COUNT,
  CUSTOM_COMMAND_ACTION_OPTIONS,
  CUSTOM_COMMAND_PERMISSION_OPTIONS,
} from '../lib/customCommands';
import WelcomeEditor from '../components/WelcomeEditor';

function roleName(name: string): string {
  return name.startsWith('@') ? name : `@${name}`;
}

function channelName(channels: GuildDetail['channels'], id: string | null | undefined): string {
  if (!id) return '#unknown-channel';
  const ch = channels.find((c) => c.id === id);
  return ch?.name ? `#${ch.name}` : `#${id}`;
}

function ChannelSelect({
  channels,
  value,
  onChange,
  placeholder = 'Select channel',
}: {
  channels: GuildDetail['channels'];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  const categories = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  const selectableChannels = channels.filter((c) => c.type !== 4);
  const uncategorized = selectableChannels.filter((c) => !c.parent_id).sort((a, b) => a.position - b.position);

  const grouped: Array<{ label: string; id: string; isCategory: boolean }> = [];
  const includedIds = new Set<string>();

  for (const ch of uncategorized) {
    grouped.push({ label: `# ${ch.name}`, id: ch.id, isCategory: false });
    includedIds.add(ch.id);
  }

  for (const cat of categories) {
    grouped.push({ label: cat.name.toUpperCase(), id: cat.id, isCategory: true });
    const children = selectableChannels.filter((c) => c.parent_id === cat.id).sort((a, b) => a.position - b.position);
    for (const ch of children) {
      grouped.push({ label: `  # ${ch.name}`, id: ch.id, isCategory: false });
      includedIds.add(ch.id);
    }
  }

  const needsFallback = value && value !== '__none__' && !includedIds.has(value);

  return (
    <Select value={value ?? '__none__'} onValueChange={(v) => onChange(v === '__none__' ? null : v)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        {needsFallback && (
          <SelectItem key={value} value={value!}>
            #{channels.find((c) => c.id === value)?.name || value}
          </SelectItem>
        )}
        {grouped.map((item) =>
          item.isCategory ? (
            <div key={item.id} className="px-2 py-1.5 text-xs font-semibold text-muted-foreground select-none">
              {item.label}
            </div>
          ) : (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
  placeholder = 'Select role',
}: {
  roles: GuildDetail['roles'];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  const sorted = [...roles].sort((a, b) => b.position - a.position);
  return (
    <Select value={value ?? '__none__'} onValueChange={(v) => onChange(v === '__none__' ? null : v)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        {sorted.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {roleName(r.name)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const LOG_EVENT_TYPES = [
  { key: 'member_join', label: 'Member Join', desc: 'When a member joins the server' },
  { key: 'member_leave', label: 'Member Leave', desc: 'When a member leaves the server' },
  { key: 'member_role_update', label: 'Member Role Update', desc: "When a member's roles change" },
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
    setDisabledLogEvents((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleSave = () => {
    const parsed = prefixes
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
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
          <CardDescription>
            The characters typed before a command name, like{' '}
            <code className="text-xs bg-[hsl(var(--muted))] px-1 py-0.5 rounded">!help</code>. Separate multiple
            prefixes with commas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input value={prefixes} onChange={(e) => setPrefixes(e.target.value)} placeholder="!, f!" />
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
            <ChannelSelect
              channels={guild.channels}
              value={staffInboxChannelId}
              onChange={setStaffInboxChannelId}
              placeholder="Select inbox channel"
            />
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
          <CardDescription>
            Send specific event types to different channels instead of the default server log. Leave empty to use the
            default.
          </CardDescription>
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
          ].map((cat) => (
            <div key={cat.key} className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
              <div>
                <p className="text-sm font-medium text-white">{cat.label}</p>
                <p className="text-xs text-gray-400">{cat.desc}</p>
              </div>
              <ChannelSelect
                channels={guild.channels}
                value={logOverrides[cat.key]}
                onChange={(v) => setLogOverrides((prev) => ({ ...prev, [cat.key]: v }))}
                placeholder="Default channel"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server Event Filters</CardTitle>
          <CardDescription>
            Pick which events show up in your server events log. Everything is logged by default. Turn off anything that
            clutters your logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {LOG_EVENT_TYPES.map((evt) => (
            <div key={evt.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{evt.label}</p>
                <p className="text-xs text-gray-400">{evt.desc}</p>
              </div>
              <Switch checked={!disabledLogEvents.includes(evt.key)} onCheckedChange={() => toggleLogEvent(evt.key)} />
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
                <p className="text-xs text-muted-foreground">
                  Skip autorole when a raid is detected (10+ joins in 15s)
                </p>
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
            {blacklisted.map((id) => {
              const ch = guild.channels.find((c) => c.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  #{ch?.name || id}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => setBlacklisted((prev) => prev.filter((c) => c !== id))}
                  />
                </Badge>
              );
            })}
          </div>
          <ChannelSelect
            channels={guild.channels.filter((c) => !blacklisted.includes(c.id))}
            value={null}
            onChange={(v) => v && setBlacklisted((prev) => [...prev, v])}
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

  const update = (patch: Partial<typeof automod>) => setAutomod((prev) => ({ ...prev, ...patch }));
  const updateSpam = (patch: Partial<typeof automod.spam>) =>
    setAutomod((prev) => ({ ...prev, spam: { ...prev.spam, ...patch } }));
  const updateRaid = (patch: Partial<typeof automod.raid>) =>
    setAutomod((prev) => ({ ...prev, raid: { ...prev.raid, ...patch } }));

  const handleSave = () => onSave({ automod });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Automod Level</CardTitle>
          <CardDescription>
            A quick way to set all automod rules at once. You can still customize individual settings below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={automod.level} onValueChange={(v) => update({ level: v as AutomodLevel })}>
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
            {
              key: 'antiSpam' as const,
              label: 'Anti-Spam',
              desc: 'Stop users from flooding the chat with rapid messages',
            },
            { key: 'antiLink' as const, label: 'Anti-Link', desc: 'Block links that are not on the allowed list' },
            {
              key: 'antiReactionSpam' as const,
              label: 'Anti-Reaction Spam',
              desc: 'Stop users from spamming reactions on messages',
            },
            {
              key: 'ghostPing' as const,
              label: 'Ghost Ping Detection',
              desc: 'Catch when someone mentions a user then quickly deletes the message',
            },
          ].map((mod) => (
            <div key={mod.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{mod.label}</p>
                <p className="text-xs text-gray-400">{mod.desc}</p>
              </div>
              <Switch checked={automod[mod.key]} onCheckedChange={(v) => update({ [mod.key]: v })} />
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
              <Input
                type="number"
                min={2}
                max={20}
                value={automod.spam.maxMessages}
                onChange={(e) => updateSpam({ maxMessages: +e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Within seconds</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={automod.spam.timeWindow}
                onChange={(e) => updateSpam({ timeWindow: +e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Timeout length (min)</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={automod.spam.timeoutDuration}
                onChange={(e) => updateSpam({ timeoutDuration: +e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Strikes before timeout</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={automod.spam.violationThreshold}
                onChange={(e) => updateSpam({ violationThreshold: +e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anti-Raid</CardTitle>
          <CardDescription>
            Detects coordinated spam by tracking near-identical messages sent by multiple users at once. Noise tokens
            like [abc123] are stripped before comparison.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Users before trigger</Label>
              <Input
                type="number"
                min={2}
                max={50}
                value={automod.raid.userThreshold}
                onChange={(e) => updateRaid({ userThreshold: +e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Within seconds</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={automod.raid.timeWindow}
                onChange={(e) => updateRaid({ timeWindow: +e.target.value })}
              />
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
            <Input
              type="number"
              min={0}
              max={50}
              value={automod.maxMentions}
              onChange={(e) => update({ maxMentions: +e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Max lines per message</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={automod.maxLines}
              onChange={(e) => update({ maxLines: +e.target.value })}
            />
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
              {automod.exemptRoles.map((id) => {
                const role = guild.roles.find((r) => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => update({ exemptRoles: automod.exemptRoles.filter((r) => r !== id) })}
                    />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect
              roles={guild.roles.filter((r) => !automod.exemptRoles.includes(r.id))}
              value={null}
              onChange={(v) => v && update({ exemptRoles: [...automod.exemptRoles, v] })}
              placeholder="Add exempt role..."
            />
          </div>
          <div className="space-y-2">
            <Label>Exempt Channels</Label>
            <div className="flex flex-wrap gap-1">
              {automod.exemptChannels.map((id) => {
                const ch = guild.channels.find((c) => c.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    #{ch?.name || id}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => update({ exemptChannels: automod.exemptChannels.filter((c) => c !== id) })}
                    />
                  </Badge>
                );
              })}
            </div>
            <ChannelSelect
              channels={guild.channels.filter((c) => !automod.exemptChannels.includes(c.id))}
              value={null}
              onChange={(v) => v && update({ exemptChannels: [...automod.exemptChannels, v] })}
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
            onChange={(e) =>
              update({
                allowedDomains: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
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

  const handleSave = () =>
    onSave({
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
              <RoleSelect
                roles={guild.roles}
                value={mod.muteRoleId}
                onChange={(v) => setMod((p) => ({ ...p, muteRoleId: v }))}
              />
              <p className="text-xs text-gray-500">
                The role given to muted members (should have Send Messages denied)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Mod Log Channel</Label>
              <ChannelSelect
                channels={guild.channels}
                value={mod.logChannelId}
                onChange={(v) => setMod((p) => ({ ...p, logChannelId: v }))}
              />
              <p className="text-xs text-gray-500">Where ban/kick/warn actions are logged</p>
            </div>
          </div>
          <div className="space-y-2 max-w-xs">
            <Label>Mute Method</Label>
            <Select
              value={mod.muteMethod ?? 'auto'}
              onValueChange={(v) => setMod((p) => ({ ...p, muteMethod: v as 'auto' | 'timeout' | 'mute_role' }))}
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
            <Switch checked={mod.autoMute} onCheckedChange={(v) => setMod((p) => ({ ...p, autoMute: v }))} />
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
                setMod((p) => ({ ...p, autoMuteThreshold: clamped }));
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
                <Select value={kwAction} onValueChange={(v) => setKwAction(v as any)}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
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
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() => setKwKeywords((prev) => prev.filter((_, idx) => idx !== i))}
                      />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newKw}
                    onChange={(e) => setNewKw(e.target.value)}
                    placeholder="Add keyword..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newKw.trim()) {
                        setKwKeywords((prev) => [
                          ...prev,
                          { pattern: newKw.trim(), isRegex: false, label: null, addedBy: null },
                        ]);
                        setNewKw('');
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newKw.trim()) {
                        setKwKeywords((prev) => [
                          ...prev,
                          { pattern: newKw.trim(), isRegex: false, label: null, addedBy: null },
                        ]);
                        setNewKw('');
                      }
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
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
            <p className="text-xs text-gray-500">
              Roles that can use the slowmode command (staff role always has access)
            </p>
            <div className="flex flex-wrap gap-1">
              {slowmodeRoles.map((id) => {
                const role = guild.roles.find((r) => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setSlowmodeRoles((prev) => prev.filter((r) => r !== id))}
                    />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect
              roles={guild.roles.filter((r) => !slowmodeRoles.includes(r.id))}
              value={null}
              onChange={(v) => v && setSlowmodeRoles((prev) => [...prev, v])}
              placeholder="Add role..."
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>Bot Command Allowed Roles</Label>
            <p className="text-xs text-gray-500">Extra roles that can use bot commands beyond the staff role</p>
            <div className="flex flex-wrap gap-1">
              {commandRoles.map((id) => {
                const role = guild.roles.find((r) => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setCommandRoles((prev) => prev.filter((r) => r !== id))}
                    />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect
              roles={guild.roles.filter((r) => !commandRoles.includes(r.id))}
              value={null}
              onChange={(v) => v && setCommandRoles((prev) => [...prev, v])}
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
  {
    key: 'admin',
    label: 'Admin & Config',
    desc: 'automod, setlog, setprefix, welcome, ticket, lockdown, reaction roles',
  },
  { key: 'info', label: 'Info', desc: 'serverinfo, userinfo, roleinfo, botinfo, uptime' },
  { key: 'general', label: 'General', desc: 'help, ping, report, invite-me' },
];

const INDIVIDUAL_COMMANDS = [
  'ban',
  'kick',
  'warn',
  'mute',
  'unmute',
  'timeout',
  'clear',
  'slowmode',
  'massban',
  'lockdown',
  'automod',
  'welcome',
  'goodbye',
  'ticket',
  'honeypot',
  'reactionrole',
  'setlog',
  'setserverlog',
  'setprefix',
  'clearprefix',
  'rss',
  'setstaff',
  'autorole',
  'roleall',
  'roleclear',
  'blacklist',
  'keywords',
  'customcommand',
  'commandperms',
  'slowmodeperms',
  'globalban',
  'help',
  'ping',
  'report',
  'invite-me',
  'serverinfo',
  'userinfo',
  'botinfo',
  'roleinfo',
  'rolelist',
  'inrole',
  'uptime',
  'warnings',
];

function CustomCommandsTab({ settings, guild, onSave, saving }: TabProps) {
  const [commands, setCommands] = useState<CustomCommand[]>(() => {
    const initial = Array.isArray(settings.customCommands)
      ? settings.customCommands.slice(0, CUSTOM_COMMAND_MAX_COUNT)
      : [];
    const payload = buildCustomCommandsSavePayload(initial);
    return payload.ok ? payload.payload : initial;
  });
  const [disabled, setDisabled] = useState<string[]>(settings.disabledCommands || []);
  const [draft, setDraft] = useState<CustomCommand>(createCustomCommandDraft());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  const resetDraft = () => {
    setDraft(createCustomCommandDraft());
    setEditingIndex(null);
  };

  const startEdit = (index: number) => {
    const command = commands[index];
    if (!command) return;

    setDraft({
      ...createCustomCommandDraft(),
      ...command,
      actionType: command.actionType ?? 'reply',
      targetRoleId: command.targetRoleId ?? null,
      requiredRoleIds: command.requiredRoleIds ?? [],
      allowedChannelIds: command.allowedChannelIds ?? [],
      requiredPermission: command.requiredPermission ?? null,
      cooldownSeconds: command.cooldownSeconds ?? 0,
      enabled: command.enabled !== false,
      deleteTrigger: !!command.deleteTrigger,
    });
    setEditingIndex(index);
    setTabError(null);
  };

  const removeCommand = (index: number) => {
    setCommands((prev) => prev.filter((_, idx) => idx !== index));

    if (editingIndex === index) {
      resetDraft();
      return;
    }

    if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const upsertCommand = () => {
    setTabError(null);

    if (editingIndex === null && commands.length >= CUSTOM_COMMAND_MAX_COUNT) {
      setTabError(`You can only create up to ${CUSTOM_COMMAND_MAX_COUNT} custom commands per server.`);
      return;
    }

    const candidate =
      editingIndex === null ? [...commands, draft] : commands.map((cmd, idx) => (idx === editingIndex ? draft : cmd));

    const payload = buildCustomCommandsSavePayload(candidate);
    if (!payload.ok) {
      setTabError(payload.error);
      return;
    }

    setCommands(payload.payload);
    resetDraft();
  };

  const toggleDisabled = (name: string) => {
    setDisabled((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const handleSave = () => {
    const payload = buildCustomCommandsSavePayload(commands);
    if (!payload.ok) {
      setTabError(payload.error);
      return;
    }

    onSave({ customCommands: payload.payload, disabledCommands: disabled });
  };

  const limitReached = commands.length >= CUSTOM_COMMAND_MAX_COUNT && editingIndex === null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Custom Commands</CardTitle>
            <Badge variant={limitReached ? 'destructive' : 'secondary'}>
              {commands.length}/{CUSTOM_COMMAND_MAX_COUNT}
            </Badge>
          </div>
          <CardDescription>
            Build advanced command workflows with role and permission gates, channel constraints, cooldowns, and
            response rendering.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tabError && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{tabError}</div>
          )}

          {commands.length === 0 && (
            <p className="text-sm text-gray-400">
              No custom commands configured yet. Use the workflow builder below to add one.
            </p>
          )}

          {commands.map((cmd, i) => (
            <div
              key={`${cmd.name}-${i}`}
              className="space-y-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-white">!{cmd.name}</p>
                  <p className="text-xs text-gray-400 truncate">{cmd.response}</p>
                </div>
                <div className="flex items-center gap-1">
                  {!cmd.enabled && <Badge variant="destructive">Disabled</Badge>}
                  {cmd.embed && <Badge variant="secondary">Embed</Badge>}
                  <Button variant="ghost" size="sm" onClick={() => startEdit(i)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => removeCommand(i)}>
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary">Action: {cmd.actionType === 'toggleRole' ? 'Toggle Role' : 'Reply'}</Badge>
                {cmd.actionType === 'toggleRole' && cmd.targetRoleId && (
                  <Badge variant="secondary">
                    Target Role:{' '}
                    {roleName(guild.roles.find((r) => r.id === cmd.targetRoleId)?.name || cmd.targetRoleId)}
                  </Badge>
                )}
                {cmd.requiredPermission && <Badge variant="secondary">Perm: {cmd.requiredPermission}</Badge>}
                {cmd.requiredRoleIds.length > 0 && (
                  <Badge variant="secondary">Roles: {cmd.requiredRoleIds.length}</Badge>
                )}
                {cmd.allowedChannelIds.length > 0 && (
                  <Badge variant="secondary">Channels: {cmd.allowedChannelIds.length}</Badge>
                )}
                {cmd.cooldownSeconds > 0 && <Badge variant="secondary">Cooldown: {cmd.cooldownSeconds}s</Badge>}
                {cmd.deleteTrigger && <Badge variant="secondary">Delete Trigger</Badge>}
              </div>
            </div>
          ))}

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">
                {editingIndex === null ? 'Workflow Builder' : `Editing !${commands[editingIndex]?.name || ''}`}
              </p>
              {editingIndex !== null && (
                <Button variant="ghost" size="sm" onClick={resetDraft}>
                  Cancel Edit
                </Button>
              )}
            </div>

            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 space-y-3">
              <p className="text-xs text-gray-300">
                Visual flow: Trigger -&gt; Access Gate -&gt; Context Gate -&gt; Action
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2">
                  <p className="font-medium text-white">Trigger</p>
                  <p className="text-gray-400 font-mono">!{draft.name.trim().toLowerCase() || 'command-name'}</p>
                </div>
                <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2">
                  <p className="font-medium text-white">Access Gate</p>
                  <p className="text-gray-400">{draft.requiredPermission || 'No permission gate'}</p>
                  <p className="text-gray-400">{draft.requiredRoleIds.length} required role(s)</p>
                </div>
                <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2">
                  <p className="font-medium text-white">Context Gate</p>
                  <p className="text-gray-400">{draft.allowedChannelIds.length} channel scope(s)</p>
                  <p className="text-gray-400">Cooldown: {draft.cooldownSeconds || 0}s</p>
                </div>
                <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2">
                  <p className="font-medium text-white">Action</p>
                  <p className="text-gray-400">
                    {draft.actionType === 'toggleRole' ? 'Toggle role for mentioned user' : 'Reply only'}
                  </p>
                  {draft.actionType === 'toggleRole' && (
                    <p className="text-gray-400">
                      Role:{' '}
                      {draft.targetRoleId
                        ? roleName(guild.roles.find((r) => r.id === draft.targetRoleId)?.name || draft.targetRoleId)
                        : 'Not set'}
                    </p>
                  )}
                  <p className="text-gray-400">{draft.embed ? 'Embed response' : 'Text response'}</p>
                  <p className="text-gray-400">
                    {draft.deleteTrigger ? 'Delete trigger message' : 'Keep trigger message'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Command Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="status-check"
                />
              </div>
              <div className="space-y-2">
                <Label>Command Action</Label>
                <Select
                  value={draft.actionType}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      actionType: value as CustomCommand['actionType'],
                      targetRoleId: value === 'toggleRole' ? prev.targetRoleId : null,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOM_COMMAND_ACTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Permission Gate (Optional)</Label>
                <Select
                  value={draft.requiredPermission ?? '__none__'}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      requiredPermission: value === '__none__' ? null : (value as CustomCommand['requiredPermission']),
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No extra permission requirement</SelectItem>
                    {CUSTOM_COMMAND_PERMISSION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {draft.actionType === 'toggleRole' && (
              <div className="space-y-2 max-w-xl">
                <Label>Role To Toggle On Mentioned User</Label>
                <RoleSelect
                  roles={guild.roles}
                  value={draft.targetRoleId}
                  onChange={(value) => setDraft((prev) => ({ ...prev, targetRoleId: value }))}
                  placeholder="Select role to add/remove"
                />
                <p className="text-xs text-gray-500">
                  This command expects a mention or user ID argument, for example: !{draft.name || 'perms'} @user
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Response</Label>
              <Textarea
                value={draft.response}
                onChange={(e) => setDraft((prev) => ({ ...prev, response: e.target.value }))}
                placeholder="Welcome {user}, this is {server}."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Enabled</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(v) => setDraft((prev) => ({ ...prev, enabled: v }))}
                  />
                  <span className="text-xs text-gray-400">Toggle command availability</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Embed Response</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={draft.embed} onCheckedChange={(v) => setDraft((prev) => ({ ...prev, embed: v }))} />
                  <span className="text-xs text-gray-400">Use rich embed format</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Delete Trigger Message</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={draft.deleteTrigger}
                    onCheckedChange={(v) => setDraft((prev) => ({ ...prev, deleteTrigger: v }))}
                  />
                  <span className="text-xs text-gray-400">Clean chat after command</span>
                </div>
              </div>
            </div>

            {draft.embed && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Embed Title</Label>
                  <Input
                    value={draft.title || ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Command Output"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Embed Color (Hex)</Label>
                  <Input
                    value={draft.color || ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, color: e.target.value }))}
                    placeholder="#5865F2"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Required Roles (Optional)</Label>
                <div className="flex flex-wrap gap-1 min-h-6">
                  {draft.requiredRoleIds.map((id) => {
                    const role = guild.roles.find((r) => r.id === id);
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {roleName(role?.name || id)}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              requiredRoleIds: prev.requiredRoleIds.filter((roleId) => roleId !== id),
                            }))
                          }
                        />
                      </Badge>
                    );
                  })}
                </div>
                <RoleSelect
                  roles={guild.roles.filter((role) => !draft.requiredRoleIds.includes(role.id))}
                  value={null}
                  onChange={(value) => {
                    if (!value || draft.requiredRoleIds.includes(value)) return;
                    setDraft((prev) => ({
                      ...prev,
                      requiredRoleIds: [...prev.requiredRoleIds, value],
                    }));
                  }}
                  placeholder="Add required role..."
                />
              </div>

              <div className="space-y-2">
                <Label>Allowed Channels (Optional)</Label>
                <div className="flex flex-wrap gap-1 min-h-6">
                  {draft.allowedChannelIds.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {channelName(guild.channels, id)}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            allowedChannelIds: prev.allowedChannelIds.filter((channelId) => channelId !== id),
                          }))
                        }
                      />
                    </Badge>
                  ))}
                </div>
                <ChannelSelect
                  channels={guild.channels}
                  value={null}
                  onChange={(value) => {
                    if (!value || draft.allowedChannelIds.includes(value)) return;
                    setDraft((prev) => ({
                      ...prev,
                      allowedChannelIds: [...prev.allowedChannelIds, value],
                    }));
                  }}
                  placeholder="Add allowed channel..."
                />
              </div>
            </div>

            <div className="space-y-2 max-w-xs">
              <Label>Cooldown (Seconds)</Label>
              <Input
                type="number"
                min={0}
                max={3600}
                value={draft.cooldownSeconds}
                onChange={(e) => {
                  const raw = Number.parseInt(e.target.value, 10);
                  setDraft((prev) => ({
                    ...prev,
                    cooldownSeconds: Number.isFinite(raw) ? raw : 0,
                  }));
                }}
                placeholder="0"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={upsertCommand} disabled={limitReached && editingIndex === null}>
                <Plus className="h-4 w-4 mr-1" />
                {editingIndex === null ? 'Add Command' : 'Update Command'}
              </Button>
              {editingIndex !== null && (
                <Button size="sm" variant="outline" onClick={resetDraft}>
                  Cancel
                </Button>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Variables supported in response: {'{user}'}, {'{server}'}, {'{channel}'}, {'{target}'}, {'{role}'},{' '}
              {'{action}'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disable Modules</CardTitle>
          <CardDescription>
            Turn off entire command categories. All commands in a disabled module will stop working.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {COMMAND_MODULES.map((mod) => (
            <div key={mod.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{mod.label}</p>
                <p className="text-xs text-gray-400">{mod.desc}</p>
              </div>
              <Switch checked={!disabled.includes(mod.key)} onCheckedChange={() => toggleDisabled(mod.key)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disable Individual Commands</CardTitle>
          <CardDescription>
            Turn off specific commands without disabling the whole module. Disabled commands are silently ignored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {INDIVIDUAL_COMMANDS.map((cmd) => (
              <Badge
                key={cmd}
                variant={disabled.includes(cmd) ? 'destructive' : 'secondary'}
                className="cursor-pointer select-none"
                onClick={() => toggleDisabled(cmd)}
              >
                {disabled.includes(cmd) ? '✕ ' : ''}
                {cmd}
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

type DashboardRssFeed = GuildSettingsType['rss']['feeds'][number];

interface DashboardRssStatusRow {
  feedId: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

interface DashboardRssTestResult {
  title: string;
  description: string | null;
  link: string;
  publishedAt: string | null;
  author: string | null;
}

const RSS_MIN_INTERVAL_MINUTES = 10;
const RSS_MAX_INTERVAL_MINUTES = 1440;
const RSS_MIN_ITEMS_PER_POLL = 1;
const RSS_MAX_ITEMS_PER_POLL = 10;
const RSS_MAX_FEEDS = 5;

const clampNumber = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const createDashboardRssFeed = (): DashboardRssFeed => ({
  id: Math.random().toString(36).slice(2, 10),
  name: null,
  sourceType: 'rss',
  url: '',
  route: null,
  channelId: '',
  mentionRoleId: null,
  webhookId: null,
  webhookToken: null,
  webhookName: null,
  enabled: true,
  maxItemsPerPoll: 3,
  includeSummary: true,
  includeImage: true,
  format: 'embed',
});

function RssTab({ settings, guild, onSave, saving }: TabProps) {
  const [enabled, setEnabled] = useState(settings.rss.enabled ?? false);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(settings.rss.pollIntervalMinutes ?? 15);
  const [feeds, setFeeds] = useState<DashboardRssFeed[]>(
    (settings.rss.feeds || []).slice(0, RSS_MAX_FEEDS).map((feed) => ({
      id: typeof feed.id === 'string' && feed.id.trim().length > 0 ? feed.id : Math.random().toString(36).slice(2, 10),
      name: feed.name ?? null,
      sourceType: feed.sourceType === 'rsshub' ? 'rsshub' : 'rss',
      url: feed.url ?? null,
      route: feed.route ?? null,
      channelId: feed.channelId ?? '',
      mentionRoleId: feed.mentionRoleId ?? null,
      webhookId: feed.webhookId ?? null,
      webhookToken: feed.webhookToken ?? null,
      webhookName: feed.webhookName ?? null,
      enabled: feed.enabled !== false,
      maxItemsPerPoll: clampNumber(
        typeof feed.maxItemsPerPoll === 'number' ? feed.maxItemsPerPoll : 3,
        RSS_MIN_ITEMS_PER_POLL,
        RSS_MAX_ITEMS_PER_POLL,
      ),
      includeSummary: feed.includeSummary !== false,
      includeImage: feed.includeImage !== false,
      format: feed.format === 'text' ? 'text' : 'embed',
    })),
  );
  const [statusRows, setStatusRows] = useState<DashboardRssStatusRow[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [testLoadingByFeedId, setTestLoadingByFeedId] = useState<Record<string, boolean>>({});
  const [testResultByFeedId, setTestResultByFeedId] = useState<Record<string, DashboardRssTestResult | null>>({});

  const updateFeed = (feedId: string, patch: Partial<DashboardRssFeed>) => {
    setFeeds((prev) => prev.map((feed) => (feed.id === feedId ? { ...feed, ...patch } : feed)));
  };

  const addFeed = () => {
    if (feeds.length >= RSS_MAX_FEEDS) return;
    setFeeds((prev) => [...prev, createDashboardRssFeed()]);
  };

  const removeFeed = (feedId: string) => {
    setFeeds((prev) => prev.filter((feed) => feed.id !== feedId));
    setTestResultByFeedId((prev) => {
      const next = { ...prev };
      delete next[feedId];
      return next;
    });
  };

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/rss/status`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch RSS status');
      setStatusRows(Array.isArray(data) ? data : []);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to fetch RSS status');
    } finally {
      setStatusLoading(false);
    }
  }, [settings.guildId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const runTest = async (feed: DashboardRssFeed) => {
    setTabError(null);
    setTestResultByFeedId((prev) => ({ ...prev, [feed.id]: null }));
    setTestLoadingByFeedId((prev) => ({ ...prev, [feed.id]: true }));

    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/rss/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: feed.sourceType,
          url: feed.sourceType === 'rss' ? (feed.url || '').trim() : null,
          route: feed.sourceType === 'rsshub' ? (feed.route || '').trim() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Feed test failed');

      const item = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null;
      setTestResultByFeedId((prev) => ({
        ...prev,
        [feed.id]: {
          title: item?.title || data.title || 'Untitled item',
          description: data.description || null,
          link: item?.link || data.link || '',
          publishedAt: item?.publishedAt || null,
          author: item?.author || null,
        },
      }));
    } catch (error) {
      setTabError(error instanceof Error ? error.message : 'Feed test failed');
    } finally {
      setTestLoadingByFeedId((prev) => ({ ...prev, [feed.id]: false }));
    }
  };

  const handleSave = () => {
    setTabError(null);
    const result = buildRssSavePayload({
      enabled,
      pollIntervalMinutes,
      feeds,
    });

    if (!result.ok) {
      setTabError(result.error);
      return;
    }

    onSave({
      rss: result.payload,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>RSS Settings</CardTitle>
          <CardDescription>
            Configure RSS/Atom URLs or RSSHub routes and post updates into your channels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-white/10 bg-[hsl(var(--muted))] px-3 py-3 space-y-1 text-xs text-gray-300">
            <p className="font-medium text-white">RSSHub Quick Guide</p>
            <p>Use full URLs for RSS/Atom sources: https://example.com/feed.xml</p>
            <p>Use path-only routes for RSSHub sources: /github/issue/dorkydigital/fluxy</p>
            <p>For X/Twitter accounts, most RSSHub instances use: /twitter/user/username</p>
            <p>Do not include the RSSHub domain in the route input.</p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium text-white">Enable RSS Polling</Label>
              <p className="text-xs text-gray-400">When disabled, feeds stay saved but no updates are posted.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="max-w-xs space-y-2">
            <Label>Poll Interval (minutes)</Label>
            <Input
              type="number"
              min={RSS_MIN_INTERVAL_MINUTES}
              max={RSS_MAX_INTERVAL_MINUTES}
              value={pollIntervalMinutes}
              onChange={(e) =>
                setPollIntervalMinutes(
                  clampNumber(Number(e.target.value || 15), RSS_MIN_INTERVAL_MINUTES, RSS_MAX_INTERVAL_MINUTES),
                )
              }
            />
            <p className="text-xs text-gray-500">
              Allowed range: {RSS_MIN_INTERVAL_MINUTES}-{RSS_MAX_INTERVAL_MINUTES}.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Feeds</CardTitle>
              <CardDescription>You can add up to {RSS_MAX_FEEDS} feeds per server.</CardDescription>
            </div>
            <Button size="sm" onClick={addFeed} disabled={feeds.length >= RSS_MAX_FEEDS}>
              <Plus className="h-4 w-4 mr-1" /> Add Feed
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {feeds.length === 0 && (
            <div className="text-sm text-gray-400 rounded-md border border-dashed border-white/20 p-4">
              No feeds configured yet.
            </div>
          )}

          {feeds.map((feed, index) => {
            const sourceValue = feed.sourceType === 'rss' ? feed.url || '' : feed.route || '';
            const status = statusRows.find((row) => row.feedId === feed.id);

            return (
              <div key={feed.id} className="rounded-lg border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">Feed {index + 1}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant={feed.enabled ? 'secondary' : 'destructive'}>
                      {feed.enabled ? 'Enabled' : 'Paused'}
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => removeFeed(feed.id)}>
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Source Type</Label>
                    <Select
                      value={feed.sourceType}
                      onValueChange={(value) => {
                        const sourceType = value === 'rsshub' ? 'rsshub' : 'rss';
                        updateFeed(feed.id, {
                          sourceType,
                          url: sourceType === 'rss' ? feed.url || '' : null,
                          route: sourceType === 'rsshub' ? feed.route || '' : null,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rss">RSS / Atom URL</SelectItem>
                        <SelectItem value="rsshub">RSSHub Route</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Destination Channel</Label>
                    <ChannelSelect
                      channels={guild.channels.filter((c) => c.type === 0 || c.type === 5)}
                      value={feed.channelId}
                      onChange={(value) => updateFeed(feed.id, { channelId: value || '' })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{feed.sourceType === 'rss' ? 'Feed URL' : 'RSSHub Route'}</Label>
                  <Input
                    value={sourceValue}
                    onChange={(e) =>
                      updateFeed(
                        feed.id,
                        feed.sourceType === 'rss' ? { url: e.target.value } : { route: e.target.value },
                      )
                    }
                    placeholder={feed.sourceType === 'rss' ? 'https://example.com/feed.xml' : '/twitter/user/username'}
                  />
                  <p className="text-xs text-gray-500">
                    {feed.sourceType === 'rss'
                      ? 'Use a full http(s) feed URL.'
                      : 'Use a route path starting with /. Example: /twitter/user/username'}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Feed Name (optional)</Label>
                    <Input
                      value={feed.name || ''}
                      onChange={(e) => updateFeed(feed.id, { name: e.target.value || null })}
                      placeholder="Engineering Blog"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Mention Role (optional)</Label>
                    <RoleSelect
                      roles={guild.roles}
                      value={feed.mentionRoleId}
                      onChange={(value) => updateFeed(feed.id, { mentionRoleId: value || null })}
                      placeholder="No role mention"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Items Per Poll</Label>
                    <Input
                      type="number"
                      min={RSS_MIN_ITEMS_PER_POLL}
                      max={RSS_MAX_ITEMS_PER_POLL}
                      value={feed.maxItemsPerPoll}
                      onChange={(e) =>
                        updateFeed(feed.id, {
                          maxItemsPerPoll: clampNumber(
                            Number(e.target.value || 3),
                            RSS_MIN_ITEMS_PER_POLL,
                            RSS_MAX_ITEMS_PER_POLL,
                          ),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="flex items-center justify-between rounded-md bg-[hsl(var(--muted))] px-3 py-2">
                    <Label className="text-xs">Feed Enabled</Label>
                    <Switch
                      checked={feed.enabled}
                      onCheckedChange={(value) => updateFeed(feed.id, { enabled: value })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md bg-[hsl(var(--muted))] px-3 py-2">
                    <Label className="text-xs">Use Embeds</Label>
                    <Switch
                      checked={feed.format !== 'text'}
                      onCheckedChange={(value) => updateFeed(feed.id, { format: value ? 'embed' : 'text' })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md bg-[hsl(var(--muted))] px-3 py-2">
                    <Label className="text-xs">Include Summary</Label>
                    <Switch
                      checked={feed.includeSummary}
                      onCheckedChange={(value) => updateFeed(feed.id, { includeSummary: value })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md bg-[hsl(var(--muted))] px-3 py-2">
                    <Label className="text-xs">Include Image</Label>
                    <Switch
                      checked={feed.includeImage}
                      onCheckedChange={(value) => updateFeed(feed.id, { includeImage: value })}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runTest(feed)}
                    disabled={!sourceValue.trim() || !!testLoadingByFeedId[feed.id]}
                  >
                    {testLoadingByFeedId[feed.id] ? 'Testing...' : 'Test Feed'}
                  </Button>

                  {status && (
                    <p className="text-xs text-gray-400">
                      Last check: {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : 'never'}
                      {' • '}
                      Last success: {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : 'never'}
                      {' • '}
                      Failures: {status.consecutiveFailures}
                    </p>
                  )}
                </div>

                {status?.lastError && (
                  <div className="text-xs text-red-300 bg-red-950/30 border border-red-900/40 rounded-md px-3 py-2">
                    {status.lastError}
                  </div>
                )}

                {testResultByFeedId[feed.id] && (
                  <div className="text-xs text-gray-200 bg-[hsl(var(--muted))] rounded-md px-3 py-2">
                    <p className="font-medium text-white">{testResultByFeedId[feed.id]?.title}</p>
                    {testResultByFeedId[feed.id]?.description && (
                      <p className="mt-1 text-xs text-gray-300 line-clamp-2">
                        {testResultByFeedId[feed.id]?.description}
                      </p>
                    )}
                    {testResultByFeedId[feed.id]?.author && (
                      <p className="mt-1 text-xs text-gray-400">By {testResultByFeedId[feed.id]?.author}</p>
                    )}
                    {testResultByFeedId[feed.id]?.publishedAt && (
                      <p className="mt-1 text-xs text-gray-400">
                        Published {new Date(testResultByFeedId[feed.id]!.publishedAt!).toLocaleString()}
                      </p>
                    )}
                    {testResultByFeedId[feed.id]?.link && (
                      <a
                        href={testResultByFeedId[feed.id]?.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-300 hover:text-blue-200 underline mt-1 inline-block"
                      >
                        Open article
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {statusError && (
            <div className="text-xs text-red-300 bg-red-950/30 border border-red-900/40 rounded-md px-3 py-2">
              {statusError}
            </div>
          )}
        </CardContent>
      </Card>

      {tabError && (
        <div className="text-sm text-red-300 bg-red-950/30 border border-red-900/40 rounded-md px-3 py-2">
          {tabError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={fetchStatus} disabled={statusLoading}>
          {statusLoading ? 'Refreshing...' : 'Refresh Status'}
        </Button>
      </div>

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

  const fetchTickets = useCallback(
    async (status: string) => {
      setTicketsLoading(true);
      try {
        const res = await fetch(`/api/guilds/${settings.guildId}/tickets?status=${status}`, { credentials: 'include' });
        if (res.ok) setTickets(await res.json());
      } catch {
      } finally {
        setTicketsLoading(false);
      }
    },
    [settings.guildId],
  );

  useEffect(() => {
    fetchTickets('open');
  }, []);

  const handleClaim = async (ticketId: string) => {
    setActionLoading(ticketId);
    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/tickets/${ticketId}/claim`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) fetchTickets(ticketFilter);
      else {
        const d = await res.json();
        alert(d.error || 'Failed to claim');
      }
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  const handleClose = async (ticketId: string) => {
    if (!confirm('Close this ticket? The channel will be deleted.')) return;
    setActionLoading(ticketId);
    try {
      const res = await fetch(`/api/guilds/${settings.guildId}/tickets/${ticketId}/close`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Closed from dashboard' }),
      });
      if (res.ok) fetchTickets(ticketFilter);
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  const handleSave = () =>
    onSave({
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

  const categories = guild.channels.filter((c) => c.type === 4);

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
              <Select
                value={categoryId ?? '__none__'}
                onValueChange={(v) => setCategoryId(v === '__none__' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
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
              {supportRoleIds.map((id) => {
                const role = guild.roles.find((r) => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {roleName(role?.name || id)}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setSupportRoleIds((prev) => prev.filter((r) => r !== id))}
                    />
                  </Badge>
                );
              })}
            </div>
            <RoleSelect
              roles={guild.roles.filter((r) => !supportRoleIds.includes(r.id) && r.id !== supportRoleId)}
              value={null}
              onChange={(v) => v && setSupportRoleIds((prev) => [...prev, v])}
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
              <Input type="number" min={1} max={10} value={maxOpen} onChange={(e) => setMaxOpen(+e.target.value)} />
              <p className="text-xs text-gray-500">Per user</p>
            </div>
            <div className="space-y-2">
              <Label>Ticket Emoji</Label>
              <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
              <p className="text-xs text-gray-500">Reaction on the panel</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Panel Message</Label>
            <Textarea
              value={openMessage}
              onChange={(e) => setOpenMessage(e.target.value)}
              placeholder="React below to open a support ticket..."
              rows={2}
            />
            <p className="text-xs text-gray-500">
              Text shown on the ticket panel. You can use: {'{user}'}, {'{server}'}, {'{ticket}'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ticket Panel Setup</CardTitle>
          <CardDescription>
            {settings.ticketSetupChannelId ? (
              <>
                Panel is active in <strong>{channelName(guild.channels, settings.ticketSetupChannelId)}</strong>. You
                can create a new one to replace it.
              </>
            ) : (
              'Create a ticket panel so members can react to open tickets. This will create the category and channel automatically if needed.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => handleSetup(false)} disabled={setupLoading} className="w-full">
            {setupLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Setting up...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" /> Create New Ticket Channel + Panel
              </>
            )}
          </Button>
          <p className="text-xs text-gray-500 text-center">
            Creates a "Tickets" category (if needed) and a #make-a-ticket channel with the panel
          </p>

          <Separator />

          <div className="space-y-2">
            <Label>Or post the panel in an existing channel:</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <ChannelSelect
                  channels={guild.channels}
                  value={setupChannelId}
                  onChange={setSetupChannelId}
                  placeholder="Pick a channel..."
                />
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
            <Button
              size="sm"
              variant={ticketFilter === 'open' ? 'default' : 'outline'}
              onClick={() => {
                setTicketFilter('open');
                fetchTickets('open');
              }}
            >
              Open
            </Button>
            <Button
              size="sm"
              variant={ticketFilter === 'closed' ? 'default' : 'outline'}
              onClick={() => {
                setTicketFilter('closed');
                fetchTickets('closed');
              }}
            >
              Closed
            </Button>
          </div>

          {ticketsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-gray-500">No {ticketFilter} tickets.</p>
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => (
                <div key={t._id} className="flex items-center gap-3 p-3 rounded-lg bg-[hsl(var(--muted))]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">Ticket #{t.ticketNumber}</p>
                      {t.claimedBy && (
                        <Badge variant="secondary" className="text-xs">
                          Claimed
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      Opened by {t.openedBy}
                      {t.subject && <> · {t.subject}</>}
                      {t.claimedBy && <> · Claimed by {t.claimedBy}</>}
                      {' · '}
                      {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {t.status === 'open' && (
                    <div className="flex gap-1.5 shrink-0">
                      {!t.claimedBy && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionLoading === t._id}
                          onClick={() => handleClaim(t._id)}
                        >
                          {actionLoading === t._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Claim'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={actionLoading === t._id}
                        onClick={() => handleClose(t._id)}
                      >
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
    if (channels.some((c) => c.channelId === newChannelId)) return;
    setChannels((prev) => [
      ...prev,
      {
        channelId: newChannelId,
        action: 'ban',
        enabled: true,
        banDeleteDays: 1,
        timeoutHours: 24,
        roleId: null,
      },
    ]);
    setNewChannelId(null);
  };

  const updateChannel = (i: number, patch: Partial<HoneypotEntry>) =>
    setChannels((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const removeChannel = (i: number) => setChannels((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = () => onSave({ honeypotChannels: channels, honeypotAlertRoleId: alertRoleId });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Honeypot Channels</CardTitle>
          <CardDescription>
            Trap channels that catch raiders and bots. Anyone who sends a message in these channels gets punished
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Alert Role</Label>
            <RoleSelect
              roles={guild.roles}
              value={alertRoleId}
              onChange={setAlertRoleId}
              placeholder="Role to notify"
            />
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
                    <Switch checked={ch.enabled} onCheckedChange={(v) => updateChannel(i, { enabled: v })} />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeChannel(i)}>
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Action</Label>
                    <Select value={ch.action} onValueChange={(v) => updateChannel(i, { action: v as any })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                      <Input
                        type="number"
                        min={1}
                        max={672}
                        value={ch.timeoutHours}
                        onChange={(e) => updateChannel(i, { timeoutHours: +e.target.value })}
                      />
                    </div>
                  )}
                  {ch.action === 'ban' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Delete Days</Label>
                      <Input
                        type="number"
                        min={0}
                        max={7}
                        value={ch.banDeleteDays}
                        onChange={(e) => updateChannel(i, { banDeleteDays: +e.target.value })}
                      />
                    </div>
                  )}
                  {ch.action === 'role' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Role to Add</Label>
                      <RoleSelect
                        roles={guild.roles}
                        value={ch.roleId}
                        onChange={(v) => updateChannel(i, { roleId: v })}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex gap-2">
            <div className="flex-1">
              <ChannelSelect
                channels={guild.channels.filter((c) => !channels.some((h) => h.channelId === c.id))}
                value={newChannelId}
                onChange={setNewChannelId}
                placeholder="Add honeypot channel..."
              />
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
  const v = settings.verification || ({} as any);
  const [enabled, setEnabled] = useState(v.enabled ?? false);
  const [verifiedRoleId, setVerifiedRoleId] = useState(v.verifiedRoleId);
  const [categoryId, setCategoryId] = useState(v.categoryId);
  const [logChannelId, setLogChannelId] = useState(v.logChannelId);
  const [panelChannelId, setPanelChannelId] = useState(v.panelChannelId);
  const [panelMessageId, setPanelMessageId] = useState(v.panelMessageId);
  const [maxAttempts, setMaxAttempts] = useState(v.maxAttempts ?? 2);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<string | null>(null);

  const handleSave = () =>
    onSave({
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
        method: 'POST',
        credentials: 'include',
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

  const categories = guild.channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Manual Verification
          </CardTitle>
          <CardDescription>Require new members to solve a captcha before gaining access to the server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm space-y-1">
            <p className="font-medium text-blue-400">How Verification Works</p>
            <p className="text-gray-400">
              1. A panel with a ✅ reaction is posted in a channel visible to unverified users.
            </p>
            <p className="text-gray-400">2. When a user reacts, a private channel is created with a captcha image.</p>
            <p className="text-gray-400">3. The user types the 6-letter code to get the Verified role.</p>
            <p className="text-gray-400 mt-2">
              <strong>Prerequisites:</strong> Fluxy needs <strong>Manage Channels</strong>,{' '}
              <strong>Manage Roles</strong>, and <strong>Add Reactions</strong> permissions. The Verified role must be
              below Fluxy's role in the hierarchy.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Verification</Label>
              <p className="text-sm text-muted-foreground">
                When enabled, users react to a panel to start a captcha challenge.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Verified Role</Label>
              <RoleSelect
                roles={guild.roles}
                value={verifiedRoleId}
                onChange={setVerifiedRoleId}
                placeholder="Select verified role"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The role granted after passing verification. Deny @everyone View Channel on your server channels and
                allow this role to see them.
              </p>
            </div>
            <div>
              <Label>Verification Category</Label>
              <Select value={categoryId || ''} onValueChange={(val: string) => setCategoryId(val || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Private captcha channels are created here.</p>
            </div>
            <div>
              <Label>Panel Channel</Label>
              <ChannelSelect
                channels={guild.channels}
                value={panelChannelId}
                onChange={setPanelChannelId}
                placeholder="Channel for the verification panel"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Where the ✅ reaction panel is posted. Should be visible to unverified users.
              </p>
            </div>
            <div>
              <Label>Log Channel</Label>
              <ChannelSelect
                channels={guild.channels}
                value={logChannelId}
                onChange={setLogChannelId}
                placeholder="Optional log channel"
              />
            </div>
            <div>
              <Label>Max Attempts</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                How many tries before the user is kicked from the channel.
              </p>
            </div>
          </div>

          <Separator />

          <div>
            <Label>Quick Setup</Label>
            <p className="text-sm text-muted-foreground mb-2">
              Auto-create a Verification category, #verify-here channel, Verified role, and post the panel. Use this if
              you're setting up for the first time.
            </p>
            <Button onClick={handleSetup} disabled={setupLoading} variant="outline">
              {setupLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…
                </>
              ) : (
                'Run Setup'
              )}
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
                <Button variant="outline" size="sm" onClick={handleSetup} disabled={setupLoading}>
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
    (settings.reactionRoles || []).map((p) => ({ ...p, roles: [...p.roles.map((r) => ({ ...r }))] })),
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
      i === panelIdx ? { ...p, roles: p.roles.filter((_, j) => j !== mappingIdx) } : p,
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
      setPanels((prev) => [...prev, { messageId: data.messageId, channelId: data.channelId, roles: [] }]);
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

  const addMapping = async (panel: {
    messageId: string;
    channelId: string;
    roles: Array<{ emoji: string; roleId: string }>;
  }) => {
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
      setPanels((prev) =>
        prev.map((p) =>
          p.messageId === panel.messageId
            ? { ...p, roles: [...p.roles, { emoji: data.emoji, roleId: data.roleId }] }
            : p,
        ),
      );
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
              <p className="text-xs text-gray-400">
                Send a private message to users when they get or lose a role from reacting
              </p>
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
            Create a reaction role panel directly from the dashboard. Select a channel, optional title and description,
            then add emoji-role mappings below.
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
                onChange={(e) => setNewTitle(e.target.value)}
                className="bg-[hsl(var(--muted))]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="React below to get a role."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="bg-[hsl(var(--muted))] min-h-[60px]"
            />
          </div>
          <Button onClick={createPanel} disabled={!newChannelId || creating}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" /> Create Panel
              </>
            )}
          </Button>
          {addError && <p className="text-sm text-red-400">{addError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Panels</CardTitle>
          <CardDescription>
            Your reaction role panels. Add mappings with an emoji and a role. Custom server emojis are listed first
            below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {panels.length === 0 ? (
            <p className="text-sm text-gray-500">
              No panels yet. Create one above or use{' '}
              <code className="text-xs bg-[hsl(var(--muted))] px-1 py-0.5 rounded">!rr post #channel</code> in your
              server.
            </p>
          ) : (
            panels.map((panel, i) => {
              const ch = guild.channels.find((c) => c.id === panel.channelId);
              const isAdding = addPanelIdx === i;
              return (
                <div key={i} className="p-3 rounded-lg bg-[hsl(var(--muted))] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">#{ch?.name || panel.channelId}</Badge>
                      <span className="text-xs text-gray-400 font-mono">msg: {panel.messageId}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-gray-400 hover:text-red-400"
                      onClick={() => void removePanel(i)}
                      disabled={creating}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {panel.roles.map((rr, j) => {
                      const role = guild.roles.find((r) => r.id === rr.roleId);
                      const removeRole = rr.removeRoleId ? guild.roles.find((r) => r.id === rr.removeRoleId) : null;
                      return (
                        <div
                          key={j}
                          className="group flex items-center gap-1 text-xs bg-[hsl(var(--background))] px-2 py-1 rounded"
                        >
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
                          <button
                            className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-400 disabled:opacity-40"
                            onClick={() => void removeMapping(i, j)}
                            disabled={creating}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    {panel.roles.length < 20 &&
                      (isAdding ? (
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
                            <Button size="sm" variant="outline" onClick={() => setEmojiPickerOpen((v) => !v)}>
                              <Smile className="h-3.5 w-3.5 mr-1" />
                              {emojiPickerOpen ? 'Close Picker' : 'Open Emoji Picker'}
                            </Button>
                            <Input
                              placeholder="Emoji or custom name:id"
                              value={addEmoji}
                              onChange={(e) => setAddEmoji(e.target.value)}
                              className="w-52 h-8 text-xs"
                            />
                            <RoleSelect
                              roles={guild.roles}
                              value={addRoleId}
                              onChange={setAddRoleId}
                              placeholder="Role"
                            />
                            <Button
                              size="sm"
                              onClick={() => addMapping(panel)}
                              disabled={!addRoleId || !addEmoji.trim() || creating}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Add mapping
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setAddPanelIdx(null);
                                setAddRoleId(null);
                                setAddEmoji('');
                                setAddError(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                          <p className="text-[11px] text-gray-400">
                            Custom emoji format:{' '}
                            <code className="text-[10px] bg-[hsl(var(--muted))] px-0.5 rounded">name:id</code>. Unicode
                            emojis can be selected from the picker.
                          </p>
                        </div>
                      ) : (
                        <button
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                          onClick={() => setAddPanelIdx(i)}
                        >
                          <Plus className="h-3 w-3" /> Add mapping
                        </button>
                      ))}
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

  const handleSave = () =>
    onSave({
      lockdownRoles,
      lockdownAllowedRoles: allowedRoles,
      lockdownAllowedUsers: allowedUsers,
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Roles to Lock</CardTitle>
          <CardDescription>
            These roles lose their ability to send messages when you run{' '}
            <code className="text-xs bg-[hsl(var(--muted))] px-1 py-0.5 rounded">!lockdown</code> (in addition to
            @everyone)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {lockdownRoles.map((id) => {
              const role = guild.roles.find((r) => r.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  {roleName(role?.name || id)}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => setLockdownRoles((prev) => prev.filter((r) => r !== id))}
                  />
                </Badge>
              );
            })}
          </div>
          <RoleSelect
            roles={guild.roles.filter((r) => !lockdownRoles.includes(r.id))}
            value={null}
            onChange={(v) => v && setLockdownRoles((prev) => [...prev, v])}
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
            {allowedRoles.map((id) => {
              const role = guild.roles.find((r) => r.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  {roleName(role?.name || id)}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => setAllowedRoles((prev) => prev.filter((r) => r !== id))}
                  />
                </Badge>
              );
            })}
          </div>
          <RoleSelect
            roles={guild.roles.filter((r) => !allowedRoles.includes(r.id))}
            value={null}
            onChange={(v) => v && setAllowedRoles((prev) => [...prev, v])}
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
            {allowedUsers.map((id) => (
              <Badge key={id} variant="secondary" className="gap-1 font-mono">
                {id}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => setAllowedUsers((prev) => prev.filter((u) => u !== id))}
                />
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              placeholder="User ID (e.g. 123456789012345678)"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && /^\d{17,20}$/.test(newUserId.trim())) {
                  setAllowedUsers((prev) => (prev.includes(newUserId.trim()) ? prev : [...prev, newUserId.trim()]));
                  setNewUserId('');
                }
              }}
            />
            <Button
              size="sm"
              onClick={() => {
                if (/^\d{17,20}$/.test(newUserId.trim())) {
                  setAllowedUsers((prev) => (prev.includes(newUserId.trim()) ? prev : [...prev, newUserId.trim()]));
                  setNewUserId('');
                }
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}

function GoodbyeTab({ settings, guild, onSave, saving }: TabProps) {
  const [goodbye, setGoodbye] = useState(settings.goodbyeMessage);

  const update = (patch: Partial<typeof goodbye>) => setGoodbye((prev) => ({ ...prev, ...patch }));
  const updateEmbed = (patch: Partial<typeof goodbye.embed>) =>
    setGoodbye((prev) => ({ ...prev, embed: { ...prev.embed, ...patch } }));

  const handleSave = () => onSave({ goodbyeMessage: goodbye });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserMinus className="h-4 w-4" /> Goodbye Message
          </CardTitle>
          <CardDescription>Send a message when a member leaves your server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Enabled</p>
              <p className="text-xs text-gray-400">Post a message when someone leaves the server</p>
            </div>
            <Switch checked={goodbye.enabled} onCheckedChange={(v) => update({ enabled: v })} />
          </div>

          {goodbye.enabled && (
            <>
              <Separator />

              <div className="space-y-2">
                <Label>Goodbye Channel</Label>
                <ChannelSelect
                  channels={guild.channels}
                  value={goodbye.channelId}
                  onChange={(v) => update({ channelId: v })}
                />
                <p className="text-xs text-gray-500">Where the goodbye message is sent</p>
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  value={goodbye.message || ''}
                  onChange={(e) => update({ message: e.target.value })}
                  placeholder="Goodbye {user}, we'll miss you!"
                  rows={3}
                />
                <p className="text-xs text-gray-500">
                  Variables: {'{user}'} {'{username}'} {'{server}'} {'{count}'}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {goodbye.enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Goodbye Embed
            </CardTitle>
            <CardDescription>Add a rich embed box below the goodbye message</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Enabled</p>
                <p className="text-xs text-gray-400">Show an embed alongside the goodbye text</p>
              </div>
              <Switch checked={goodbye.embed.enabled} onCheckedChange={(v) => updateEmbed({ enabled: v })} />
            </div>
            {goodbye.embed.enabled && (
              <>
                <Separator />
                {/* Embed preview bar */}
                <div className="rounded-lg overflow-hidden border border-white/10">
                  <div className="flex">
                    <div className="w-1 shrink-0" style={{ backgroundColor: goodbye.embed.color || '#5865F2' }} />
                    <div className="p-4 space-y-2 flex-1 bg-[hsl(var(--muted))]">
                      {goodbye.embed.title && <p className="text-sm font-semibold text-white">{goodbye.embed.title}</p>}
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
                  <Input
                    value={goodbye.embed.title || ''}
                    onChange={(e) => updateEmbed({ title: e.target.value })}
                    placeholder="Embed title"
                  />
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Color</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={goodbye.embed.color || '#5865F2'}
                          onChange={(e) => updateEmbed({ color: e.target.value })}
                          className="h-9 w-9 rounded border border-white/10 bg-transparent cursor-pointer shrink-0"
                        />
                        <Input
                          value={goodbye.embed.color || ''}
                          onChange={(e) => updateEmbed({ color: e.target.value })}
                          placeholder="#5865F2"
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <Textarea
                  value={goodbye.embed.description || ''}
                  onChange={(e) => updateEmbed({ description: e.target.value })}
                  placeholder="Embed description - supports {user}, {server}, {count}"
                  rows={3}
                />
                <Input
                  value={goodbye.embed.footer || ''}
                  onChange={(e) => updateEmbed({ footer: e.target.value })}
                  placeholder="Footer text"
                />
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
  type StarboardStats = {
    totalEntries: number;
    totalStars: number;
    postedCount: number;
    topUsers?: Array<{ _id: string; totalStars: number; messageCount: number }>;
    boardBreakdown?: Array<{ _id: string | null; stars: number; messages: number }>;
  };

  const makeBoard = (raw?: Partial<Starboard>): Starboard => ({
    enabled: !!raw?.enabled,
    channelId: raw?.channelId ?? null,
    threshold: typeof raw?.threshold === 'number' ? raw.threshold : 3,
    emoji: raw?.emoji ?? '⭐',
    selfStarEnabled: !!raw?.selfStarEnabled,
    ignoreBots: raw?.ignoreBots === false ? false : true,
    ignoredChannels: Array.isArray(raw?.ignoredChannels) ? raw.ignoredChannels : [],
    ignoredRoles: Array.isArray(raw?.ignoredRoles) ? raw.ignoredRoles : [],
  });

  const deriveBoards = () => {
    const source = settings.starboards?.length ? settings.starboards : [settings.starboard];
    return source.slice(0, 3).map(makeBoard);
  };

  const [boards, setBoards] = useState<Starboard[]>(deriveBoards);
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [stats, setStats] = useState<StarboardStats | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('all');

  useEffect(() => {
    setBoards(deriveBoards());
  }, [settings.starboards, settings.starboard]);

  useEffect(() => {
    if (!guildId) return;
    const query = selectedBoardId !== 'all' && selectedBoardId ? `?boardId=${selectedBoardId}` : '';
    api
      .get<any[]>(`/guilds/${guildId}/starboard/leaderboard${query}`, { skipCache: true })
      .then(setLeaderboard)
      .catch(() => {});
    api
      .get<StarboardStats>(`/guilds/${guildId}/starboard/stats${query}`, { skipCache: true })
      .then(setStats)
      .catch(() => {});
  }, [guildId, selectedBoardId]);

  const updateBoard = (index: number, patch: Partial<Starboard>) => {
    setBoards((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const addBoard = () => {
    if (boards.length >= 3) return;
    const template = boards[0] ?? makeBoard();
    setBoards((prev) => [
      ...prev,
      makeBoard({ ...template, channelId: null, enabled: true, ignoredChannels: [], ignoredRoles: [] }),
    ]);
  };

  const removeBoard = (index: number) => {
    if (boards.length <= 1) return;
    const target = boards[index];
    setBoards((prev) => prev.filter((_, i) => i !== index));
    if (selectedBoardId !== 'all' && selectedBoardId === target?.channelId) setSelectedBoardId('all');
  };

  const handleEmojiClick = (boardKey: string, emojiData: EmojiClickData) => {
    const idx = boards.findIndex((b, i) => (b.channelId || `board-${i}`) === boardKey);
    if (idx !== -1) updateBoard(idx, { emoji: emojiData.emoji });
    setEmojiPickerFor(null);
  };

  const handleSave = () => {
    const sanitized = boards
      .map(makeBoard)
      .map((b) => ({
        ...b,
        threshold: Math.max(1, Math.min(100, b.threshold)),
        ignoredChannels: (b.ignoredChannels || []).filter(Boolean),
        ignoredRoles: (b.ignoredRoles || []).filter(Boolean),
      }))
      .slice(0, 3);

    onSave({ starboards: sanitized, starboard: sanitized[0] ?? makeBoard() });
  };

  const boardFilterOptions = boards
    .filter((b) => b.channelId)
    .map((b) => ({ id: b.channelId!, label: channelName(guild.channels, b.channelId) }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-4 w-4" /> Starboards
            </CardTitle>
            <CardDescription>Configure up to three boards to spotlight great messages</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedBoardId} onValueChange={(v) => setSelectedBoardId(v)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter board" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All boards</SelectItem>
                {boardFilterOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={addBoard} disabled={boards.length >= 3}>
              <Plus className="h-4 w-4 mr-1" /> Add board
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {boards.map((board, idx) => {
              const key = board.channelId || `board-${idx}`;
              const showPicker = emojiPickerFor === key;
              return (
                <Card key={key} className="border border-white/10 bg-[hsl(var(--muted))]">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">Board {idx + 1}</CardTitle>
                      <p className="text-xs text-gray-400">{channelName(guild.channels, board.channelId)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {boards.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeBoard(idx)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Switch checked={board.enabled} onCheckedChange={(v) => updateBoard(idx, { enabled: v })} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Starboard Channel</Label>
                        <ChannelSelect
                          channels={guild.channels}
                          value={board.channelId}
                          onChange={(v) => updateBoard(idx, { channelId: v })}
                          placeholder="Select starboard channel"
                        />
                        <p className="text-xs text-gray-500">Where starred messages are posted</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Threshold</Label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={board.threshold}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!Number.isNaN(v)) updateBoard(idx, { threshold: Math.max(1, Math.min(100, v)) });
                          }}
                        />
                        <p className="text-xs text-gray-500">Reactions needed before featuring</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Tracked Emoji</Label>
                      <div className="flex items-center gap-3">
                        <div className="text-2xl px-3 py-1 rounded-lg bg-black/30 border border-white/10">
                          {board.emoji}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setEmojiPickerFor(showPicker ? null : key)}>
                          <Smile className="h-4 w-4 mr-1" /> Change Emoji
                        </Button>
                      </div>
                      {showPicker && (
                        <div className="mt-2">
                          <EmojiPicker
                            theme={Theme.DARK}
                            onEmojiClick={(data) => handleEmojiClick(key, data)}
                            lazyLoadEmojis
                          />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">Allow Self-Starring</p>
                          <p className="text-xs text-gray-400">Let authors star their own messages</p>
                        </div>
                        <Switch
                          checked={board.selfStarEnabled}
                          onCheckedChange={(v) => updateBoard(idx, { selfStarEnabled: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">Ignore Bot Messages</p>
                          <p className="text-xs text-gray-400">Skip tracking bot-authored posts</p>
                        </div>
                        <Switch
                          checked={board.ignoreBots}
                          onCheckedChange={(v) => updateBoard(idx, { ignoreBots: v })}
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label>Ignored Channels</Label>
                      <p className="text-xs text-gray-500">Messages in these channels are skipped</p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {board.ignoredChannels.map((id) => (
                          <Badge key={id} variant="secondary" className="gap-1">
                            {channelName(guild.channels, id)}
                            <X
                              className="h-3 w-3 cursor-pointer"
                              onClick={() =>
                                updateBoard(idx, { ignoredChannels: board.ignoredChannels.filter((c) => c !== id) })
                              }
                            />
                          </Badge>
                        ))}
                      </div>
                      <ChannelSelect
                        channels={guild.channels.filter((c) => !board.ignoredChannels.includes(c.id))}
                        value={null}
                        onChange={(v) => v && updateBoard(idx, { ignoredChannels: [...board.ignoredChannels, v] })}
                        placeholder="Add ignored channel..."
                      />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label>Ignored Roles</Label>
                      <p className="text-xs text-gray-500">Members with these roles can't add stars</p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {board.ignoredRoles.map((id) => {
                          const role = guild.roles.find((r) => r.id === id);
                          return (
                            <Badge key={id} variant="secondary" className="gap-1">
                              @{role?.name || id}
                              <X
                                className="h-3 w-3 cursor-pointer"
                                onClick={() =>
                                  updateBoard(idx, { ignoredRoles: board.ignoredRoles.filter((r) => r !== id) })
                                }
                              />
                            </Badge>
                          );
                        })}
                      </div>
                      <RoleSelect
                        roles={guild.roles.filter((r) => !board.ignoredRoles.includes(r.id))}
                        value={null}
                        onChange={(v) => v && updateBoard(idx, { ignoredRoles: [...board.ignoredRoles, v] })}
                        placeholder="Add ignored role..."
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>Statistics</CardTitle>
            <CardDescription>
              {selectedBoardId === 'all' ? 'Across all boards' : `Only ${channelName(guild.channels, selectedBoardId)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

            {stats.boardBreakdown?.length ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-gray-400">Boards</p>
                <div className="space-y-1">
                  {stats.boardBreakdown.map((b) => (
                    <div key={b._id ?? 'unknown'} className="flex items-center justify-between text-sm text-gray-300">
                      <span>{b._id ? channelName(guild.channels, b._id) : 'Unknown board'}</span>
                      <span className="text-gray-400">
                        {b.stars} stars • {b.messages} messages
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {leaderboard.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Leaderboard</CardTitle>
            <CardDescription>Top starred messages for this filter</CardDescription>
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
                    {entry.starboardChannelId && (
                      <span className="text-xs text-gray-400">
                        · {channelName(guild.channels, entry.starboardChannelId)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    by &lt;@{entry.authorId}&gt; in {channelName(guild.channels, entry.channelId)}
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
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
          </>
        ) : (
          <>
            <Save className="h-4 w-4 mr-2" /> Save Changes
          </>
        )}
      </Button>
    </div>
  );
}

export function GuildSettings() {
  const { guildId } = useParams<{ guildId: string }>();
  const { guild, settings, loading, saving, error, updateSettings, refetchSettings } = useGuildData(guildId);
  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const saveNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSaveNotice = useCallback((notice: { type: 'success' | 'error'; message: string }) => {
    setSaveNotice(notice);
    if (saveNoticeTimeoutRef.current) clearTimeout(saveNoticeTimeoutRef.current);
    saveNoticeTimeoutRef.current = setTimeout(() => {
      setSaveNotice(null);
      saveNoticeTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (saveNoticeTimeoutRef.current) {
        clearTimeout(saveNoticeTimeoutRef.current);
      }
    };
  }, []);

  const handleSave = useCallback(
    async (patch: Partial<GuildSettingsType>) => {
      try {
        await updateSettings(patch);
        showSaveNotice({ type: 'success', message: 'Settings saved' });
      } catch (err: any) {
        showSaveNotice({
          type: 'error',
          message: err?.message || 'Failed to save settings',
        });
      }
    },
    [showSaveNotice, updateSettings],
  );

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

  const tabProps: TabProps = {
    settings,
    guild,
    onSave: handleSave,
    saving,
    guildId: guildId ?? undefined,
    refetchSettings,
  };

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
              <img
                src={`https://fluxerusercontent.com/icons/${guild.id}/${guild.icon}.png?size=64`}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              guild.name.charAt(0).toUpperCase()
            )}
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
      </div>

      {/* Tabs */}
      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="flex flex-wrap gap-1 h-auto p-1">
          <TabsTrigger value="general" className="gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            General
          </TabsTrigger>
          <TabsTrigger value="automod" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Automod
          </TabsTrigger>
          <TabsTrigger value="welcome" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Welcome
          </TabsTrigger>
          <TabsTrigger value="moderation" className="gap-1.5">
            <Gavel className="h-3.5 w-3.5" />
            Moderation
          </TabsTrigger>
          <TabsTrigger value="commands" className="gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            Commands
          </TabsTrigger>
          <TabsTrigger value="rss" className="gap-1.5">
            <Rss className="h-3.5 w-3.5" />
            RSS
          </TabsTrigger>
          <TabsTrigger value="tickets" className="gap-1.5">
            <Ticket className="h-3.5 w-3.5" />
            Tickets
          </TabsTrigger>
          <TabsTrigger value="reactionroles" className="gap-1.5">
            <Smile className="h-3.5 w-3.5" />
            Reaction Roles
          </TabsTrigger>
          <TabsTrigger value="lockdown" className="gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Lockdown
          </TabsTrigger>
          <TabsTrigger value="goodbye" className="gap-1.5">
            <UserMinus className="h-3.5 w-3.5" />
            Goodbye
          </TabsTrigger>
          <TabsTrigger value="honeypot" className="gap-1.5">
            <Bug className="h-3.5 w-3.5" />
            Honeypot
          </TabsTrigger>
          <TabsTrigger value="verification" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verification
          </TabsTrigger>
          <TabsTrigger value="starboard" className="gap-1.5">
            <Star className="h-3.5 w-3.5" />
            Starboard
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab {...tabProps} />
        </TabsContent>
        <TabsContent value="automod">
          <AutomodTab {...tabProps} />
        </TabsContent>
        <TabsContent value="welcome">
          <WelcomeTab {...tabProps} />
        </TabsContent>
        <TabsContent value="moderation">
          <ModerationTab {...tabProps} />
        </TabsContent>
        <TabsContent value="commands">
          <CustomCommandsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="rss">
          <RssTab {...tabProps} />
        </TabsContent>
        <TabsContent value="tickets">
          <TicketsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="reactionroles">
          <ReactionRolesTab {...tabProps} />
        </TabsContent>
        <TabsContent value="lockdown">
          <LockdownTab {...tabProps} />
        </TabsContent>
        <TabsContent value="goodbye">
          <GoodbyeTab {...tabProps} />
        </TabsContent>
        <TabsContent value="honeypot">
          <HoneypotTab {...tabProps} />
        </TabsContent>
        <TabsContent value="verification">
          <VerificationTab {...tabProps} />
        </TabsContent>
        <TabsContent value="starboard">
          <StarboardTab {...tabProps} />
        </TabsContent>
      </Tabs>

      {saveNotice && (
        <div className="fixed top-5 right-5 z-50 w-[calc(100vw-2rem)] max-w-sm">
          <div
            className={[
              'rounded-lg border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-sm',
              saveNotice.type === 'success'
                ? 'border-green-500/40 bg-green-500/20 text-green-100'
                : 'border-red-500/40 bg-red-500/20 text-red-100',
            ].join(' ')}
          >
            {saveNotice.message}
          </div>
        </div>
      )}
    </div>
  );
}
