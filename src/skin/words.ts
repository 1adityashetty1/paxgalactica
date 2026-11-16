import type { AssetWord, CountedWord, Term, Word, Words } from './lexicon.js';

/**
 * Pax Galactica's words for the core's roles: the default lexicon.
 *
 * This is where they live. A hull's name was `HULL_SPEC.label`, a Rim event's
 * title `RIM_EVENT_TITLE`, a note's title `NOTE_TITLE` and a terrain's name a
 * table in `worldtext.ts`; each moved here when its readers began reading the
 * lexicon, so the core keeps the ids and the numbers and a skin keeps the
 * words.
 *
 * **It imports nothing at run time**, being read from the bottom of the domain
 * (`lexicon.ts` explains the cycle that would otherwise close). Its keys are
 * typed by the domain's ids, so a hull class added without a word fails the
 * typecheck, and `SkinSchema` checks it again at load like any skin.
 */

const word = (id: string, w: string, synonyms: string[] = []): Word => ({ id, word: w, synonyms });
const counted = (id: string, w: string, plural = `${w}s`): CountedWord => ({ id, word: w, plural, synonyms: [] });
const spaced = (id: string): Word => word(id, id.replace(/_/g, ' '));
const asset = (id: string, unit: string): AssetWord => ({ ...spaced(id), unit });
const term = (w: string, plural = `${w}s`, synonyms: string[] = []): Term => ({ word: w, plural, synonyms });

export const PAX_LEXICON: Words = {
  units: {
    battleship: counted('battleship', 'battleship'),
    escort: counted('escort', 'escort'),
    torpedo_boat: counted('torpedo_boat', 'torpedo boat'),
    lifter: counted('lifter', 'lifter'),
    freighter: counted('freighter', 'freighter'),
    listener: counted('listener', 'listener'),
    courier: counted('courier', 'courier'),
  },
  terrains: {
    earthlike: word('earthlike', 'Terrestrial'),
    earthnight: word('earthnight', 'Terrestrial, settled'),
    oceanic: word('oceanic', 'Oceanic'),
    arid: word('arid', 'Arid'),
    ice: word('ice', 'Ice'),
    industrialmoon: word('industrialmoon', 'Ringed moon'),
    gasgiant: word('gasgiant', 'Gas giant'),
  },
  orderCategories: {
    courier: spaced('courier'),
    decree: spaced('decree'),
    political_maneuver: spaced('political_maneuver'),
    espionage: spaced('espionage'),
    counter_intelligence: spaced('counter_intelligence'),
    blockade: spaced('blockade'),
    commerce_raiding: spaced('commerce_raiding'),
    treaty_ratification: spaced('treaty_ratification'),
    garrison_raising: spaced('garrison_raising'),
    fortification: spaced('fortification'),
    refit: spaced('refit'),
    retooling: spaced('retooling'),
    construction_infrastructure: spaced('construction_infrastructure'),
    capital_ship_construction: spaced('capital_ship_construction'),
    industrial_conversion: spaced('industrial_conversion'),
  },
  assetKinds: {
    prisoners: asset('prisoners', 'crew'),
    officer: asset('officer', 'person'),
    operative: asset('operative', 'person'),
    hostage: asset('hostage', 'person'),
    defector: asset('defector', 'person'),
    dossier: asset('dossier', 'dossier'),
    charts: asset('charts', 'chart'),
    blueprints: asset('blueprints', 'set'),
    writ: asset('writ', 'writ'),
    surety: asset('surety', 'bond'),
    ciphers: asset('ciphers', 'key'),
    ore: asset('ore', 'ton'),
    salvage: asset('salvage', 'ton'),
    contraband: asset('contraband', 'crate'),
    relic: asset('relic', 'relic'),
    military_base: asset('military_base', 'fixture'),
    university: asset('university', 'fixture'),
    factory: asset('factory', 'fixture'),
    stock_exchange: asset('stock_exchange', 'fixture'),
    hospital: asset('hospital', 'fixture'),
    special_forces_command: asset('special_forces_command', 'fixture'),
    arsenal: asset('arsenal', 'fixture'),
    defence_contractor: asset('defence_contractor', 'fixture'),
    military_academy: asset('military_academy', 'fixture'),
    research_lab: asset('research_lab', 'fixture'),
    black_market: asset('black_market', 'fixture'),
    security_bureau: asset('security_bureau', 'fixture'),
    chamber_of_commerce: asset('chamber_of_commerce', 'fixture'),
    power_plant: asset('power_plant', 'fixture'),
    civil_service: asset('civil_service', 'fixture'),
  },
  rimEvents: {
    ion_storm: word('ion_storm', 'Ion storm'),
    derelict: word('derelict', 'Derelict'),
    unrest: word('unrest', 'Unrest'),
    border_incident: word('border_incident', 'Border incident'),
    shortage: word('shortage', 'Shortage'),
    mutiny: word('mutiny', 'Mutiny'),
    rich_seam: word('rich_seam', 'Rich seam'),
    volunteers: word('volunteers', 'Volunteers'),
    free_captains: word('free_captains', 'Free captains'),
    envoys_of_peace: word('envoys_of_peace', 'Envoys of peace'),
    crackdown: word('crackdown', 'Crackdown'),
    bounty_posted: word('bounty_posted', 'A price on your head'),
    turned_contact: word('turned_contact', 'Turned contact'),
    show_of_force: word('show_of_force', 'Show of force'),
  },
  treatyTypes: {
    non_aggression: spaced('non_aggression'),
    mutual_defense: spaced('mutual_defense'),
    trade_accord: spaced('trade_accord'),
    tribute: spaced('tribute'),
    basing_rights: spaced('basing_rights'),
    ceasefire: spaced('ceasefire'),
    cession: spaced('cession'),
    contract: spaced('contract'),
    coalition: spaced('coalition'),
    marriage: spaced('marriage'),
  },
  schools: {
    lineofbattle: word('lineofbattle', 'lineofbattle'),
    gunnery: word('gunnery', 'gunnery'),
    convoy: word('convoy', 'convoy'),
    assault: word('assault', 'assault'),
  },
  noteKinds: {
    most_favoured: word('most_favoured', 'Most-favoured terms'),
    escort: word('escort', 'Escort of the line'),
    line_of_credit: word('line_of_credit', 'Line of credit'),
    sanctuary: word('sanctuary', 'Sanctuary'),
    safe_passage: word('safe_passage', 'Safe passage'),
  },
  phases: {
    strike: word('strike', 'strike'),
    orbital: word('orbital', 'orbital'),
    ground: word('ground', 'ground'),
  },
  fleetKinds: {
    line: word('line', 'Fleet'),
    listener: word('listener', 'Listener'),
    freighter: word('freighter', 'Freighter'),
    courier: word('courier', 'Courier'),
  },
  places: {
    world: term('world'),
    system: term('system'),
    sector: term('sector'),
    lane: term('lane', 'lanes', ['hyperlane']),
    jump: term('jump'),
    hub: term('hub'),
    orbit: term('orbit'),
    garrison: term('garrison'),
    yards: term('yards', 'yards', ['slipways']),
    rim: term('the Rim', 'the Rim'),
  },
  forces: {
    hull: term('hull'),
    ship: term('ship'),
    fleet: term('fleet'),
    crew: term('crew', 'crews'),
    navy: term('navy', 'navies'),
  },
  accounts: {
    credits: term('credit'),
    tons: term('ton'),
  },
};
