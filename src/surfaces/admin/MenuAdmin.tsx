import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Check, UtensilsCrossed } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { MenuItem, MenuCategory, MenuModifier, Station } from '@/types';
import { cn, formatIDR, stationLabel, dietaryLabel } from '@/lib/format';
import { Button, Modal, Badge, Spinner, EmptyState } from '@/components/ui';

export function MenuAdmin() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [modifiers, setModifiers] = useState<MenuModifier[]>([]);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>('');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [out, c, i, m] = await Promise.all([
      supabase.from('outlets').select('id').limit(1).maybeSingle(),
      supabase.from('menu_categories').select('*').order('sort_order'),
      supabase.from('menu_items').select('*').order('sort_order'),
      supabase.from('menu_modifiers').select('*, options:menu_modifier_options(*)').order('sort_order'),
    ]);
    if (out.data) setOutletId(out.data.id);
    setCategories((c.data as MenuCategory[]) ?? []);
    setItems((i.data as MenuItem[]) ?? []);
    setModifiers((m.data as MenuModifier[]) ?? []);
    const cats = (c.data as MenuCategory[]) ?? [];
    if (cats[0]) setActiveCat(cats[0].id);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const modsByItem = useMemo(() => {
    const m: Record<string, MenuModifier[]> = {};
    for (const mod of modifiers) {
      if (!m[mod.item_id]) m[mod.item_id] = [];
      m[mod.item_id].push(mod);
    }
    return m;
  }, [modifiers]);

  const toggleSoldOut = async (item: MenuItem) => {
    await supabase.from('menu_items').update({ sold_out: !item.sold_out }).eq('id', item.id);
    load();
  };

  const deleteItem = async (item: MenuItem) => {
    await supabase.from('menu_items').delete().eq('id', item.id);
    load();
  };

  const addCategory = async () => {
    if (!outletId) return;
    const name = window.prompt('New category name');
    if (!name?.trim()) return;
    await supabase.from('menu_categories').insert({
      outlet_id: outletId,
      name: name.trim(),
      sort_order: categories.length + 1,
    });
    load();
  };

  if (loading) {
    return <div className="py-24 text-center"><Spinner className="h-8 w-8" /></div>;
  }

  const catItems = items.filter((i) => i.category_id === activeCat);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto df-no-scrollbar flex-1">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={cn(
                'px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors',
                activeCat === c.id ? 'bg-ink-600 text-ink-100' : 'bg-ink-800 border border-ink-600 text-ink-400'
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={addCategory}>
          <Plus size={14} /> Category
        </Button>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Item
        </Button>
      </div>

      {catItems.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed size={44} />} title="No items in this category" hint="Add your first item — it appears on the QR page, POS and waiter app instantly." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catItems.map((item) => {
            const mods = modsByItem[item.id] ?? [];
            return (
              <div
                key={item.id}
                className={cn(
                  'rounded-2xl border bg-ink-800 overflow-hidden',
                  item.sold_out ? 'border-rose2-500/40 opacity-75' : 'border-ink-600'
                )}
              >
                {item.photo_url && (
                  <img src={item.photo_url} alt={item.name} loading="lazy" className="w-full h-28 object-cover bg-ink-700" />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-tight">{item.name}</div>
                    <div className="font-display font-bold text-saffron-400">{formatIDR(item.price_minor)}</div>
                  </div>
                  {item.description && <div className="mt-1 text-xs text-ink-400 line-clamp-2">{item.description}</div>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge className="bg-ink-600 text-ink-200 border-ink-500">{stationLabel[item.station]}</Badge>
                    {mods.length > 0 && <Badge className="bg-sky2-500/15 text-sky2-400 border-sky2-500/30">{mods.length} modifier{mods.length === 1 ? '' : 's'}</Badge>}
                    {item.sold_out && <Badge className="bg-rose2-500/15 text-rose2-400 border-rose2-500/30">Sold out</Badge>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>Edit</Button>
                    <Button size="sm" variant={item.sold_out ? 'primary' : 'outline'} onClick={() => toggleSoldOut(item)}>
                      {item.sold_out ? 'Back in stock' : 'Sold out'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteItem(item)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit / create modal */}
      {(editing || creating) && (
        <ItemEditor
          outletId={outletId!}
          categories={categories}
          item={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function ItemEditor({
  outletId, categories, item, onClose, onSaved,
}: {
  outletId: string;
  categories: MenuCategory[];
  item: MenuItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(String(item ? item.price_minor / 1000 : ''));
  const [station, setStation] = useState<Station>(item?.station ?? 'kitchen');
  const [photoUrl, setPhotoUrl] = useState(item?.photo_url ?? '');
  const [prepMin, setPrepMin] = useState(String(item ? Math.round(item.prep_time_seconds / 60) : '10'));
  const [tags, setTags] = useState<string[]>(item?.dietary_tags ?? []);
  const [allergens, setAllergens] = useState<string[]>(item?.allergens ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dietOptions = ['vegetarian', 'vegan', 'halal', 'gluten-free', 'pescatarian'];
  const allergenOptions = ['shellfish', 'peanut', 'egg', 'soy', 'dairy', 'gluten', 'fish', 'none'];

  const toggleTag = (list: string[], setList: (l: string[]) => void, v: string) => {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const priceMinor = Math.round((parseFloat(price) || 0) * 1000);
    const payload = {
      outlet_id: outletId,
      category_id: item?.category_id ?? categories[0].id,
      name: name.trim(),
      description: description.trim() || null,
      price_minor: priceMinor,
      station,
      photo_url: photoUrl.trim() || null,
      prep_time_seconds: Math.round((parseInt(prepMin) || 10) * 60),
      dietary_tags: tags,
      allergens,
    };
    if (item) {
      const { error: err } = await supabase.from('menu_items').update(payload).eq('id', item.id);
      if (err) { setSaving(false); setError(err.message); return; }
    } else {
      const { error: err } = await supabase.from('menu_items').insert(payload);
      if (err) { setSaving(false); setError(err.message); return; }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.name}` : 'New menu item'} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-ink-400 block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-ink-400 block mb-1">Price (in thousands, e.g. 95 = Rp 95.000)</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-ink-400 block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-xl bg-ink-700 border border-ink-600 p-3 text-sm resize-none focus:border-saffron-500 focus:outline-none"
          />
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-ink-400 block mb-1">Prep station</label>
            <select
              value={station}
              onChange={(e) => setStation(e.target.value as Station)}
              className="w-full h-10 px-2 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:outline-none"
            >
              {(['kitchen', 'bar', 'dessert', 'coffee'] as const).map((s) => (
                <option key={s} value={s}>{stationLabel[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-400 block mb-1">Prep time (min)</label>
            <input
              value={prepMin}
              onChange={(e) => setPrepMin(e.target.value)}
              inputMode="numeric"
              className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-ink-400 block mb-1">Photo URL</label>
            <input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://…"
              className="w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-ink-400 block mb-1.5">Dietary tags</label>
          <div className="flex flex-wrap gap-1.5">
            {dietOptions.map((d) => (
              <button
                key={d}
                onClick={() => toggleTag(tags, setTags, d)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border', tags.includes(d) ? 'bg-emerald2-500/15 border-emerald2-500/40 text-emerald2-400' : 'border-ink-600 text-ink-300')}
              >
                {dietaryLabel[d]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-ink-400 block mb-1.5">Allergens</label>
          <div className="flex flex-wrap gap-1.5">
            {allergenOptions.map((a) => (
              <button
                key={a}
                onClick={() => toggleTag(allergens, setAllergens, a)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border capitalize', allergens.includes(a) ? 'bg-rose2-500/15 border-rose2-500/40 text-rose2-400' : 'border-ink-600 text-ink-300')}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="text-xs text-rose2-400">{error}</div>}

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <Check size={15} />} Save item
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
