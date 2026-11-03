//! The `jottr` command line, so agents and scripts can read and change boards, tickets and notes.
//! It runs when the app's binary gets arguments (`Jottr.app/Contents/MacOS/jottr help`), uses the
//! same store functions as the app, and exits without opening a window. The running app reloads
//! when it sees the changes (`watch_outside_changes` in `lib.rs`).

use std::cmp::Ordering;
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};

use crate::db;
use crate::models::{Board, ChecklistPatch, Label, NewTicket, Note, Priority, Project, Status, Ticket, TicketPatch};
use crate::store::{self, err, CmdResult};

/// `identifier` in `tauri.conf.json`, which names the app data folder.
const IDENTIFIER: &str = "com.steojo.jottr";

const HELP: &str = r#"Jottr from the command line. It reads and changes the same data as the app,
which shows changes within a second.

Places   inbox, a board's key or name (ENG), or a board and project (ENG/iOS Apps).
         Case is ignored, and names can be shortened while they stay unambiguous.
Tickets  A board ticket's ID (ENG-28), or an Inbox ticket's full ID.
Text     Quote names and text with spaces. Pass - to read text from standard input.

Read
  jottr boards                          Boards, projects and note tabs, with open ticket counts
  jottr tickets [place] [--status S]... [--all]
                                        Tickets by status. Done and Canceled only with --all or --status
  jottr show <ticket>                   Details, description and a numbered checklist
  jottr search <text>                   Tickets anywhere, including the Archive
  jottr notes <place> [note]            A note's markdown, or the place's note tabs

Change
  jottr create <place> <title> [options]
  jottr update <ticket> [options] [--title T] [--unlabel NAME] [--tick N] [--untick N]
  jottr move <ticket> <place>           To another board, project or the Inbox
  jottr append-note <place> <note> <text>
                                        Adds text to the end of a note
  jottr replace-note <place> <note> <text>
                                        Replaces a whole note
  jottr new-note <place> <title> [text] Adds a note tab

Options
  --status S         backlog, ready, in_progress, in_review, done or canceled
  --priority P       none, low, medium, high or urgent
  --description D    Markdown, replacing the description
  --due DATE         YYYY-MM-DD, or none
  --label NAME       Adds one of the board's labels (repeatable)
  --item TEXT        Adds a checklist item (repeatable)
"#;

const STATUSES: [Status; 6] =
    [Status::Backlog, Status::Ready, Status::InProgress, Status::InReview, Status::Done, Status::Canceled];
const PRIORITIES: [Priority; 5] = [Priority::None, Priority::Low, Priority::Medium, Priority::High, Priority::Urgent];

/// Returns the exit code.
pub fn run(args: Vec<String>) -> i32 {
    if matches!(args[0].as_str(), "help" | "--help" | "-h") {
        print!("{HELP}");
        return 0;
    }
    match open().and_then(|mut conn| execute(&mut conn, &args)) {
        Ok(output) => {
            print!("{output}");
            0
        }
        Err(e) => {
            eprintln!("jottr: {e}");
            1
        }
    }
}

/// The app's database, or the one at `JOTTR_DB`, e.g. to try commands on a copy.
fn open() -> CmdResult<Connection> {
    let path = match std::env::var_os("JOTTR_DB") {
        Some(path) => PathBuf::from(path),
        None => {
            let home = std::env::var_os("HOME").ok_or_else(|| "HOME isn't set".to_string())?;
            PathBuf::from(home).join("Library/Application Support").join(IDENTIFIER).join("jottr.db")
        }
    };
    if !path.exists() {
        return Err(format!("No Jottr database at {}. Open Jottr once first.", path.display()));
    }
    db::open_existing(&path)
}

fn execute(conn: &mut Connection, args: &[String]) -> CmdResult<String> {
    let (command, rest) = args.split_first().ok_or_else(|| "No command. Run `jottr help`.".to_string())?;
    let args = Args::parse(rest)?;
    match command.as_str() {
        "boards" => boards(conn, &args),
        "tickets" => tickets(conn, &args),
        "show" => show(conn, &args),
        "search" => search(conn, &args),
        "notes" => notes(conn, &args),
        "create" => create(conn, &args),
        "update" => update(conn, &args),
        "move" => move_to(conn, &args),
        "append-note" => write_note(conn, &args, false),
        "replace-note" => write_note(conn, &args, true),
        "new-note" => new_note(conn, &args),
        other => Err(format!("Unknown command \"{other}\". Run `jottr help` to see the commands.")),
    }
}

/// Flags that take no value.
const SWITCHES: &[&str] = &["all"];

struct Args {
    positional: Vec<String>,
    flags: Vec<(String, String)>,
}

impl Args {
    fn parse(args: &[String]) -> CmdResult<Self> {
        let mut parsed = Args { positional: Vec::new(), flags: Vec::new() };
        let mut rest = args.iter();
        while let Some(arg) = rest.next() {
            let Some(flag) = arg.strip_prefix("--") else {
                parsed.positional.push(arg.clone());
                continue;
            };
            let (name, value) = match flag.split_once('=') {
                Some((name, value)) => (name.to_string(), value.to_string()),
                None if SWITCHES.contains(&flag) => (flag.to_string(), String::new()),
                None => {
                    let value = rest.next().ok_or_else(|| format!("--{flag} needs a value"))?;
                    (flag.to_string(), value.clone())
                }
            };
            parsed.flags.push((name, value));
        }
        Ok(parsed)
    }

    /// Refuses flags the command doesn't take, so a typo isn't silently ignored.
    fn allow(&self, names: &[&str]) -> CmdResult<()> {
        match self.flags.iter().find(|(name, _)| !names.contains(&name.as_str())) {
            Some((name, _)) => Err(format!("Unknown option --{name} here. Run `jottr help` to see the options.")),
            None => Ok(()),
        }
    }

    /// Refuses extra words, which usually mean a name needed quotes.
    fn at_most(&self, count: usize) -> CmdResult<()> {
        match self.positional.get(count) {
            Some(extra) => Err(format!("Unexpected \"{extra}\". Put names and text with spaces in quotes.")),
            None => Ok(()),
        }
    }

    fn arg(&self, index: usize, what: &str) -> CmdResult<&str> {
        self.positional
            .get(index)
            .map(String::as_str)
            .ok_or_else(|| format!("Missing the {what}. Run `jottr help` for usage."))
    }

    fn get<'a>(&'a self, name: &'a str) -> Option<&'a str> {
        self.all(name).last()
    }

    fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.flags.iter().filter(move |(n, _)| n == name).map(|(_, value)| value.as_str())
    }
}

/// `-` reads standard input, so long markdown needn't be quoted for the shell.
fn text(value: &str) -> CmdResult<String> {
    if value != "-" {
        return Ok(value.to_string());
    }
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).map_err(err)?;
    Ok(input)
}

/// The one item `input` names, ignoring case: an exact match, or else the only one it starts.
/// The first name is the one shown in errors.
fn pick<T>(items: Vec<T>, input: &str, kind: &str, names: impl Fn(&T) -> Vec<&str>) -> CmdResult<T> {
    let input = input.trim();
    let wanted = input.to_lowercase();
    let matching = |exact: bool| -> Vec<usize> {
        let fits = |name: &str| {
            let name = name.to_lowercase();
            if exact { name == wanted } else { name.starts_with(&wanted) }
        };
        (0..items.len()).filter(|&i| names(&items[i]).into_iter().any(fits)).collect()
    };
    let mut found = matching(true);
    if found.is_empty() {
        found = matching(false);
    }
    let list = |indexes: &mut dyn Iterator<Item = usize>| {
        indexes.map(|i| names(&items[i])[0].to_string()).collect::<Vec<_>>().join(", ")
    };
    match found.as_slice() {
        &[index] => Ok(items.into_iter().nth(index).expect("index into items")),
        [] if items.is_empty() => Err(format!("No {kind} \"{input}\". There aren't any yet.")),
        [] => Err(format!("No {kind} \"{input}\". Try one of: {}", list(&mut (0..items.len())))),
        _ => Err(format!("\"{input}\" could be more than one {kind}: {}", list(&mut found.iter().copied()))),
    }
}

/// Where tickets and notes live: a board, a project on a board, or the Inbox (neither).
struct Place {
    board: Option<Board>,
    project: Option<Project>,
}

impl Place {
    fn find(conn: &Connection, input: &str) -> CmdResult<Self> {
        if input.trim().eq_ignore_ascii_case("inbox") {
            return Ok(Place { board: None, project: None });
        }
        let (board, project) = match input.split_once('/') {
            Some((board, project)) => (board, Some(project)),
            None => (input, None),
        };
        let board = pick(store::list_boards(conn)?, board, "board", |b| vec![b.key.as_str(), b.name.as_str()])?;
        let project = match project {
            Some(name) => {
                let projects = store::list_projects(conn)?.into_iter().filter(|p| p.board_id == board.id).collect();
                Some(pick(projects, name, &format!("project on {}", board.key), |p| vec![p.name.as_str()])?)
            }
            None => None,
        };
        Ok(Place { board: Some(board), project })
    }

    /// "Engineering / iOS Apps", for messages.
    fn name(&self) -> String {
        match (&self.board, &self.project) {
            (Some(board), Some(project)) => format!("{} / {}", board.name, project.name),
            (Some(board), None) => board.name.clone(),
            _ => "Inbox".into(),
        }
    }

    /// "ENG/iOS Apps", as typed on the command line.
    fn arg(&self) -> String {
        match (&self.board, &self.project) {
            (Some(board), Some(project)) => format!("{}/{}", board.key, project.name),
            (Some(board), None) => board.key.clone(),
            _ => "inbox".into(),
        }
    }

    fn notes(&self, conn: &Connection) -> CmdResult<Vec<Note>> {
        let board = self.board.as_ref().ok_or_else(|| "The Inbox has no notes.".to_string())?;
        store::list_notes(conn, board.id.clone(), self.project.as_ref().map(|p| p.id.clone()))
    }
}

/// `ENG-28`, or a ticket's full ID. Archived tickets count too.
fn find_ticket(conn: &Connection, input: &str) -> CmdResult<Ticket> {
    let input = input.trim();
    if let Some((key, number)) = input.rsplit_once('-').and_then(|(key, n)| Some((key, n.parse::<i32>().ok()?))) {
        let found = conn
            .query_row(
                &format!(
                    "SELECT {} FROM tickets t JOIN boards b ON b.id = t.board_id WHERE b.key = ?1 AND t.number = ?2",
                    Ticket::COLUMNS
                ),
                params![key.to_uppercase(), number],
                Ticket::from_row,
            )
            .optional()
            .map_err(err)?;
        if let Some(ticket) = found {
            return Ok(ticket);
        }
    }
    store::get_ticket(conn, input).map_err(|_| {
        format!("No ticket {input}. Use an ID like ENG-28, or an Inbox ticket's full ID from `jottr tickets inbox`.")
    })
}

/// `ENG-28`, or the full ID for Inbox tickets, which have no number.
fn reference(ticket: &Ticket) -> String {
    match (&ticket.board_key, ticket.number) {
        (Some(key), Some(number)) => format!("{key}-{number}"),
        _ => ticket.id.clone(),
    }
}

fn summary(ticket: &Ticket) -> String {
    format!("{}: {} ({})", reference(ticket), ticket.title, status_name(ticket.status))
}

fn parse_status(input: &str) -> CmdResult<Status> {
    let wanted = input.trim().to_lowercase().replace([' ', '-'], "_").replace("cancelled", "canceled");
    STATUSES.into_iter().find(|s| s.as_str() == wanted).ok_or_else(|| {
        format!("Unknown status \"{input}\". Use one of: {}", STATUSES.map(|s| s.as_str()).join(", "))
    })
}

fn parse_priority(input: &str) -> CmdResult<Priority> {
    let wanted = input.trim().to_lowercase();
    PRIORITIES.into_iter().find(|p| p.as_str() == wanted).ok_or_else(|| {
        format!("Unknown priority \"{input}\". Use one of: {}", PRIORITIES.map(|p| p.as_str()).join(", "))
    })
}

fn status_name(status: Status) -> &'static str {
    match status {
        Status::Backlog => "Backlog",
        Status::Ready => "Ready",
        Status::InProgress => "In Progress",
        Status::InReview => "In Review",
        Status::Done => "Done",
        Status::Canceled => "Canceled",
    }
}

fn priority_name(priority: Priority) -> &'static str {
    match priority {
        Priority::None => "No priority",
        Priority::Low => "Low",
        Priority::Medium => "Medium",
        Priority::High => "High",
        Priority::Urgent => "Urgent",
    }
}

fn finished(status: Status) -> bool {
    matches!(status, Status::Done | Status::Canceled)
}

/// The app's order within a status (`byListOrder` in `src/lib/tickets.ts`): Done newest first,
/// otherwise unfinished Urgent tickets pinned on top, then by position.
fn sort_group(tickets: &mut [&Ticket], status: Status) {
    if status == Status::Done {
        tickets.sort_by(|a, b| b.completed_at.partial_cmp(&a.completed_at).unwrap_or(Ordering::Equal));
    } else {
        let pinned = |t: &Ticket| !finished(status) && t.priority == Priority::Urgent;
        tickets.sort_by(|a, b| {
            pinned(b).cmp(&pinned(a)).then(a.position.partial_cmp(&b.position).unwrap_or(Ordering::Equal))
        });
    }
}

/// Names for the IDs tickets carry.
struct Names {
    projects: HashMap<String, String>,
    labels: HashMap<String, String>,
}

impl Names {
    fn load(conn: &Connection) -> CmdResult<Self> {
        Ok(Names {
            projects: store::list_projects(conn)?.into_iter().map(|p| (p.id, p.name)).collect(),
            labels: store::list_labels(conn)?.into_iter().map(|l| (l.id, l.name)).collect(),
        })
    }

    fn project(&self, ticket: &Ticket) -> Option<&str> {
        ticket.project_id.as_ref().and_then(|id| self.projects.get(id)).map(String::as_str)
    }

    fn labels(&self, ticket: &Ticket) -> Vec<&str> {
        ticket.label_ids.iter().filter_map(|id| self.labels.get(id)).map(String::as_str).collect()
    }

    /// One line per ticket: its ID and title, then whatever else is set. `place` adds the project,
    /// or "Inbox", for lists that span places.
    fn line(&self, ticket: &Ticket, status: bool, place: bool) -> String {
        let mut parts = vec![format!("{}  {}", reference(ticket), ticket.title)];
        if status {
            parts.push(status_name(ticket.status).into());
        }
        if ticket.priority != Priority::None {
            parts.push(priority_name(ticket.priority).into());
        }
        if place {
            match (&ticket.board_id, self.project(ticket)) {
                (None, _) => parts.push("Inbox".into()),
                (Some(_), Some(project)) => parts.push(project.into()),
                (Some(_), None) => {}
            }
        }
        if let Some(due) = &ticket.due_date {
            parts.push(format!("due {due}"));
        }
        if ticket.checklist_total > 0 {
            parts.push(format!("{}/{} checked", ticket.checklist_done, ticket.checklist_total));
        }
        let labels = self.labels(ticket);
        if !labels.is_empty() {
            parts.push(labels.join(", "));
        }
        if ticket.archived_at.is_some() {
            parts.push("archived".into());
        }
        parts.join(" · ")
    }
}

fn lines(lines: Vec<String>) -> String {
    lines.join("\n") + "\n"
}

fn boards(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&[])?;
    args.at_most(0)?;
    let mut open: HashMap<(Option<String>, Option<String>), i64> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT board_id, project_id, COUNT(*) FROM tickets
             WHERE archived_at IS NULL AND status NOT IN ('done', 'canceled') GROUP BY board_id, project_id",
        )
        .map_err(err)?;
    for row in stmt.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?))).map_err(err)? {
        let (place, count) = row.map_err(err)?;
        open.insert(place, count);
    }
    // Read directly: `list_notes` would make a first note for places that have none.
    let mut notes: HashMap<(String, Option<String>), Vec<String>> = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT board_id, project_id, title, trim(body) = '' FROM notes ORDER BY position")
        .map_err(err)?;
    for row in stmt.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?, r.get(3)?))).map_err(err)? {
        let (place, title, empty): (_, String, bool) = row.map_err(err)?;
        notes.entry(place).or_default().push(if empty { format!("{title} (empty)") } else { title });
    }
    let tabs = |board: &str, project: Option<&str>| {
        notes
            .get(&(board.to_string(), project.map(String::from)))
            .map(|titles| format!(" · notes: {}", titles.join(", ")))
            .unwrap_or_default()
    };

    let projects = store::list_projects(conn)?;
    let mut out = Vec::new();
    for board in store::list_boards(conn)? {
        let total: i64 = open.iter().filter(|((b, _), _)| b.as_deref() == Some(board.id.as_str())).map(|(_, n)| n).sum();
        out.push(format!("{}  {} · {total} open{}", board.key, board.name, tabs(&board.id, None)));
        for project in projects.iter().filter(|p| p.board_id == board.id) {
            let count = open.get(&(Some(board.id.clone()), Some(project.id.clone()))).unwrap_or(&0);
            out.push(format!("    {} · {count} open{}", project.name, tabs(&board.id, Some(&project.id))));
        }
    }
    out.push(format!("Inbox · {} open", open.get(&(None, None)).unwrap_or(&0)));
    Ok(lines(out))
}

fn tickets(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&["status", "all"])?;
    args.at_most(1)?;
    let statuses: Vec<Status> = args.all("status").map(parse_status).collect::<CmdResult<_>>()?;
    let all = args.get("all").is_some();
    let shown = |status: Status| if statuses.is_empty() { all || !finished(status) } else { statuses.contains(&status) };
    let places = match args.positional.first() {
        Some(input) => vec![Place::find(conn, input)?],
        None => {
            let boards = store::list_boards(conn)?.into_iter().map(|b| Place { board: Some(b), project: None });
            boards.chain([Place { board: None, project: None }]).collect()
        }
    };
    let names = Names::load(conn)?;

    let mut out = Vec::new();
    for place in places {
        let tickets: Vec<Ticket> = store::list_tickets(conn, place.board.as_ref().map(|b| b.id.clone()))?
            .into_iter()
            .filter(|t| place.project.as_ref().is_none_or(|p| t.project_id.as_deref() == Some(p.id.as_str())))
            .collect();
        let heading = match &place.board {
            Some(board) => format!("{} ({})", place.name(), board.key),
            None => place.name(),
        };
        out.push(heading);
        let mut listed = 0;
        for status in STATUSES.into_iter().filter(|s| shown(*s)) {
            let mut group: Vec<&Ticket> = tickets.iter().filter(|t| t.status == status).collect();
            if group.is_empty() {
                continue;
            }
            sort_group(&mut group, status);
            listed += group.len();
            out.push(format!("  {} ({})", status_name(status), group.len()));
            let project = place.board.is_some() && place.project.is_none();
            out.extend(group.iter().map(|t| format!("    {}", names.line(t, false, project))));
        }
        if listed == 0 {
            out.push("  No tickets to show.".into());
        }
        let hidden = tickets.len() - listed;
        if statuses.is_empty() && !all && hidden > 0 {
            out.push(format!("  ({hidden} Done or Canceled not shown. Add --all to see them.)"));
        }
    }
    Ok(lines(out))
}

fn show(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&[])?;
    args.at_most(1)?;
    let ticket = find_ticket(conn, args.arg(0, "ticket ID")?)?;
    let names = Names::load(conn)?;
    let board = match &ticket.board_id {
        Some(id) => store::list_boards(conn)?.into_iter().find(|b| &b.id == id).map(|b| b.name),
        None => None,
    };
    let place = match (board, names.project(&ticket)) {
        (Some(board), Some(project)) => format!("{board} / {project}"),
        (Some(board), None) => board,
        (None, _) => "Inbox".into(),
    };

    let mut facts = vec![status_name(ticket.status).to_string()];
    if ticket.priority != Priority::None {
        facts.push(priority_name(ticket.priority).into());
    }
    facts.push(place);
    if let Some(due) = &ticket.due_date {
        facts.push(format!("due {due}"));
    }
    if ticket.archived_at.is_some() {
        facts.push("archived".into());
    }
    let mut out = vec![format!("{}  {}", reference(&ticket), ticket.title), facts.join(" · ")];
    let labels = names.labels(&ticket);
    if !labels.is_empty() {
        out.push(format!("Labels: {}", labels.join(", ")));
    }
    if !ticket.description.trim().is_empty() {
        out.push(String::new());
        out.push(ticket.description.trim_end().to_string());
    }
    let checklist = store::list_checklist(conn, ticket.id.clone())?;
    if !checklist.is_empty() {
        out.push(String::new());
        out.push(format!("Checklist ({}/{} checked)", ticket.checklist_done, ticket.checklist_total));
        for (i, item) in checklist.iter().enumerate() {
            out.push(format!("  {}. [{}] {}", i + 1, if item.done { "x" } else { " " }, item.text));
        }
    }
    Ok(lines(out))
}

fn search(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&[])?;
    let query = args.positional.join(" ");
    if query.trim().is_empty() {
        return Err("Missing the text to search for.".into());
    }
    let results = store::search_tickets(conn, query.clone())?;
    if results.is_empty() {
        return Ok(format!("No tickets match \"{query}\".\n"));
    }
    let names = Names::load(conn)?;
    Ok(lines(results.iter().map(|t| names.line(t, true, true)).collect()))
}

fn notes(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&[])?;
    args.at_most(2)?;
    let place = Place::find(conn, args.arg(0, "board or project")?)?;
    let mut notes = place.notes(conn)?;
    let note = match args.positional.get(1) {
        Some(title) => pick(notes, title, "note", |n| vec![n.title.as_str()])?,
        None if notes.len() == 1 => notes.remove(0),
        None => {
            let titles: Vec<&str> = notes.iter().map(|n| n.title.as_str()).collect();
            return Ok(format!(
                "{} has {} notes: {}. Read one with `jottr notes \"{}\" \"{}\"`.\n",
                place.name(),
                notes.len(),
                titles.join(", "),
                place.arg(),
                titles[0]
            ));
        }
    };
    if note.body.trim().is_empty() {
        return Ok(format!("\"{}\" is empty.\n", note.title));
    }
    Ok(note.body.trim_end().to_string() + "\n")
}

fn write_note(conn: &mut Connection, args: &Args, replace: bool) -> CmdResult<String> {
    args.allow(&[])?;
    args.at_most(3)?;
    let place = Place::find(conn, args.arg(0, "board or project")?)?;
    let note = pick(place.notes(conn)?, args.arg(1, "note title")?, "note", |n| vec![n.title.as_str()])?;
    let addition = text(args.arg(2, "text")?)?;
    let body = if replace || note.body.trim().is_empty() {
        addition.trim_end().to_string()
    } else {
        format!("{}\n\n{}", note.body.trim_end(), addition.trim_end())
    };
    store::set_note_body(conn, note.id, body)?;
    let done = if replace { "Replaced" } else { "Added to" };
    Ok(format!("{done} \"{}\" on {}.\n", note.title, place.name()))
}

fn new_note(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&[])?;
    args.at_most(3)?;
    let place = Place::find(conn, args.arg(0, "board or project")?)?;
    let title = args.arg(1, "note title")?.trim();
    if place.notes(conn)?.iter().any(|n| n.title.eq_ignore_ascii_case(title)) {
        return Err(format!("{} already has a note called \"{title}\".", place.name()));
    }
    let board = place.board.as_ref().expect("notes() refuses the Inbox");
    let note = store::create_note(conn, board.id.clone(), place.project.as_ref().map(|p| p.id.clone()), title.into())?;
    if let Some(value) = args.positional.get(2) {
        store::set_note_body(conn, note.id, text(value)?.trim_end().into())?;
    }
    Ok(format!("Added note \"{}\" to {}.\n", note.title, place.name()))
}

/// What `create` and `update` change, all checked before anything is saved so a typo can't
/// leave a change half made.
struct Changes {
    patch: TicketPatch,
    due: Option<Option<String>>,
    labels: Vec<(String, bool)>,
    items: Vec<String>,
    ticks: Vec<(String, bool)>,
}

impl Changes {
    fn parse(conn: &Connection, args: &Args, board_id: Option<&str>, ticket_id: Option<&str>) -> CmdResult<Self> {
        let due = match args.get("due").map(str::trim) {
            None => None,
            Some("" | "none") => Some(None),
            Some(date) if store::is_valid_date(date) => Some(Some(date.to_string())),
            Some(date) => return Err(format!("Due dates look like 2026-11-05, not \"{date}\".")),
        };

        let mut labels = Vec::new();
        for (flag, applied) in [("label", true), ("unlabel", false)] {
            for name in args.all(flag) {
                let board_id = board_id.ok_or_else(|| "Inbox tickets can't have labels.".to_string())?;
                let board_labels: Vec<Label> =
                    store::list_labels(conn)?.into_iter().filter(|l| l.board_id == board_id).collect();
                labels.push((pick(board_labels, name, "label on this board", |l| vec![l.name.as_str()])?.id, applied));
            }
        }

        let mut ticks = Vec::new();
        let ticked: Vec<(&str, bool)> = args.all("tick").map(|n| (n, true)).chain(args.all("untick").map(|n| (n, false))).collect();
        if let (Some(ticket_id), false) = (ticket_id, ticked.is_empty()) {
            let checklist = store::list_checklist(conn, ticket_id.to_string())?;
            for (number, done) in ticked {
                let item = number
                    .trim()
                    .parse::<usize>()
                    .ok()
                    .and_then(|n| n.checked_sub(1))
                    .and_then(|i| checklist.get(i))
                    .ok_or_else(|| format!("No checklist item {number}. `jottr show` numbers them."))?;
                ticks.push((item.id.clone(), done));
            }
        }

        Ok(Changes {
            patch: TicketPatch {
                title: args.get("title").map(String::from),
                description: args.get("description").map(text).transpose()?,
                status: args.get("status").map(parse_status).transpose()?,
                priority: args.get("priority").map(parse_priority).transpose()?,
            },
            due,
            labels,
            items: args.all("item").map(String::from).collect(),
            ticks,
        })
    }

    fn apply(self, conn: &mut Connection, id: &str) -> CmdResult<Ticket> {
        let patch = &self.patch;
        if patch.title.is_some() || patch.description.is_some() || patch.status.is_some() || patch.priority.is_some() {
            store::update_ticket(conn, id.into(), self.patch)?;
        }
        if let Some(due) = self.due {
            store::set_due_date(conn, id.into(), due)?;
        }
        for (label, applied) in self.labels {
            store::set_ticket_label(conn, id.into(), label, applied)?;
        }
        for text in self.items {
            store::add_checklist_item(conn, id.into(), text)?;
        }
        for (item, done) in self.ticks {
            store::update_checklist_item(conn, item, ChecklistPatch { text: None, done: Some(done) })?;
        }
        store::get_ticket(conn, id)
    }
}

const TICKET_OPTIONS: [&str; 6] = ["status", "priority", "description", "due", "label", "item"];

fn create(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&TICKET_OPTIONS)?;
    args.at_most(2)?;
    let place = Place::find(conn, args.arg(0, "board, project or inbox")?)?;
    let title = args.arg(1, "title")?.to_string();
    let board_id = place.board.as_ref().map(|b| b.id.clone());
    let mut changes = Changes::parse(conn, args, board_id.as_deref(), None)?;
    // Like pressing C: Backlog, or Ready on a board whose Backlog column is hidden.
    let status = match changes.patch.status.take() {
        Some(status) => status,
        None if board_id.is_some() && !store::get_settings(conn)?.show_backlog => Status::Ready,
        None => Status::Backlog,
    };
    let priority = changes.patch.priority.take().unwrap_or(Priority::None);
    let input = NewTicket { board_id, project_id: place.project.map(|p| p.id), title, status, priority };
    let ticket = store::create_ticket(conn, input)?;
    let ticket = changes.apply(conn, &ticket.id)?;
    Ok(format!("Created {}\n", summary(&ticket)))
}

fn update(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&["title", "status", "priority", "description", "due", "label", "unlabel", "item", "tick", "untick"])?;
    args.at_most(1)?;
    let ticket = find_ticket(conn, args.arg(0, "ticket ID")?)?;
    if args.flags.is_empty() {
        return Err("Nothing to change. Run `jottr help` to see the options.".into());
    }
    let changes = Changes::parse(conn, args, ticket.board_id.as_deref(), Some(&ticket.id))?;
    let ticket = changes.apply(conn, &ticket.id)?;
    Ok(format!("Updated {}\n", summary(&ticket)))
}

fn move_to(conn: &mut Connection, args: &Args) -> CmdResult<String> {
    args.allow(&[])?;
    args.at_most(2)?;
    let ticket = find_ticket(conn, args.arg(0, "ticket ID")?)?;
    let place = Place::find(conn, args.arg(1, "board, project or inbox")?)?;
    let name = place.name();
    let before = reference(&ticket);
    let moved = store::move_ticket(conn, ticket.id, place.board.map(|b| b.id), place.project.map(|p| p.id))?;
    let after = reference(&moved);
    let renamed = if after == before { String::new() } else { format!(", now {after}") };
    Ok(format!("Moved {before} to {name}{renamed}\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Color, NewBoard};

    fn run(conn: &mut Connection, args: &[&str]) -> CmdResult<String> {
        execute(conn, &args.iter().map(|a| a.to_string()).collect::<Vec<_>>())
    }

    /// Engineering (ENG) with an iOS Apps project and a "bug" label, plus an empty Ops board.
    fn setup() -> Connection {
        let conn = db::open_in_memory().unwrap();
        let board = |name: &str, key: &str| {
            store::create_board(&conn, NewBoard { name: name.into(), key: key.into(), color: Color::Blue }).unwrap()
        };
        let eng = board("Engineering", "ENG");
        board("Ops", "OPS");
        store::create_project(&conn, eng.id.clone(), "iOS Apps".into()).unwrap();
        store::create_label(&conn, eng.id, "bug".into(), Color::Red).unwrap();
        conn
    }

    #[test]
    fn identifier_matches_the_app() {
        assert!(include_str!("../tauri.conf.json").contains(&format!("\"identifier\": \"{IDENTIFIER}\"")));
    }

    #[test]
    fn creates_updates_and_moves_tickets() {
        let mut conn = setup();
        let created = run(
            &mut conn,
            &["create", "eng/ios", "Fix login", "--priority", "urgent", "--label", "Bug", "--item", "Repro", "--item", "Fix"],
        )
        .unwrap();
        assert_eq!(created, "Created ENG-1: Fix login (Backlog)\n");

        let shown = run(&mut conn, &["show", "eng-1"]).unwrap();
        assert!(shown.starts_with("ENG-1  Fix login\nBacklog · Urgent · Engineering / iOS Apps\nLabels: bug\n"));
        assert!(shown.ends_with("Checklist (0/2 checked)\n  1. [ ] Repro\n  2. [ ] Fix\n"));

        let updated = run(&mut conn, &["update", "ENG-1", "--status", "In Progress", "--tick", "2", "--due", "2026-11-05"]);
        assert_eq!(updated.unwrap(), "Updated ENG-1: Fix login (In Progress)\n");
        let listed = run(&mut conn, &["tickets", "ENG"]).unwrap();
        assert_eq!(
            listed,
            "Engineering (ENG)\n  In Progress (1)\n    ENG-1  Fix login · Urgent · iOS Apps · due 2026-11-05 · 1/2 checked · bug\n"
        );

        assert_eq!(run(&mut conn, &["move", "ENG-1", "OPS"]).unwrap(), "Moved ENG-1 to Ops, now OPS-1\n");
        let moved = run(&mut conn, &["show", "OPS-1"]).unwrap();
        assert!(!moved.contains("Labels"), "Ops has no bug label: {moved}");

        run(&mut conn, &["update", "OPS-1", "--status", "done"]).unwrap();
        let open = run(&mut conn, &["tickets", "OPS"]).unwrap();
        assert!(open.contains("No tickets to show.") && open.contains("1 Done or Canceled not shown"));
        assert!(run(&mut conn, &["tickets", "OPS", "--all"]).unwrap().contains("  Done (1)\n    OPS-1  Fix login"));
    }

    #[test]
    fn checks_everything_before_saving() {
        let mut conn = setup();
        let typo = run(&mut conn, &["create", "ENG", "Ticket", "--label", "bgu"]).unwrap_err();
        assert!(typo.contains("No label on this board \"bgu\""), "{typo}");
        assert!(run(&mut conn, &["create", "ENG", "Ticket", "--due", "tomorrow"]).is_err());
        assert!(run(&mut conn, &["create", "inbox", "Ticket", "--label", "bug"]).is_err());
        assert!(store::list_tickets(&conn, None).unwrap().is_empty());
        assert!(run(&mut conn, &["tickets", "ENG"]).unwrap().contains("No tickets to show."));

        assert!(run(&mut conn, &["create", "ENG", "Ticket", "--sttaus", "done"]).unwrap_err().contains("--sttaus"));
        assert!(run(&mut conn, &["create", "ENG/iOS", "Apps", "Ticket"]).unwrap_err().contains("in quotes"));
        assert!(run(&mut conn, &["update", "ENG-9", "--status", "done"]).unwrap_err().contains("No ticket ENG-9"));
        assert!(run(&mut conn, &["create", "ENG", "Ticket", "--status", "doing"]).unwrap_err().contains("in_progress"));
    }

    #[test]
    fn finds_places_by_key_name_or_prefix() {
        let mut conn = setup();
        store::create_board(&conn, NewBoard { name: "Operations".into(), key: "OPR".into(), color: Color::Red }).unwrap();
        assert!(run(&mut conn, &["tickets", "engineering/IOS APPS"]).unwrap().starts_with("Engineering / iOS Apps (ENG)"));
        // "Ops" names one board exactly, though it also starts "Operations".
        assert!(run(&mut conn, &["tickets", "ops"]).unwrap().starts_with("Ops (OPS)"));
        assert!(run(&mut conn, &["tickets", "op"]).unwrap_err().contains("more than one board: OPS, OPR"));
        assert!(run(&mut conn, &["tickets", "ENG/Web"]).unwrap_err().contains("Try one of: iOS Apps"));
    }

    #[test]
    fn reads_and_writes_notes() {
        let mut conn = setup();
        run(&mut conn, &["notes", "ENG/iOS Apps"]).unwrap();
        assert_eq!(run(&mut conn, &["append-note", "ENG/iOS Apps", "notes", "- first"]).unwrap(), "Added to \"Notes\" on Engineering / iOS Apps.\n");
        run(&mut conn, &["append-note", "ENG/iOS Apps", "Notes", "- second\n"]).unwrap();
        assert_eq!(run(&mut conn, &["notes", "ENG/iOS Apps"]).unwrap(), "- first\n\n- second\n");

        run(&mut conn, &["new-note", "ENG/iOS Apps", "Foldr Notes", "# Foldr"]).unwrap();
        assert!(run(&mut conn, &["new-note", "ENG/iOS Apps", "foldr notes"]).is_err());
        let tabs = run(&mut conn, &["notes", "ENG/iOS Apps"]).unwrap();
        assert!(tabs.starts_with("Engineering / iOS Apps has 2 notes: Notes, Foldr Notes."), "{tabs}");
        run(&mut conn, &["replace-note", "ENG/iOS Apps", "Foldr", "# Foldr v2"]).unwrap();
        assert_eq!(run(&mut conn, &["notes", "ENG/iOS Apps", "foldr"]).unwrap(), "# Foldr v2\n");
        assert!(run(&mut conn, &["notes", "inbox"]).is_err());

        let boards = run(&mut conn, &["boards"]).unwrap();
        assert!(boards.contains("    iOS Apps · 0 open · notes: Notes, Foldr Notes\n"), "{boards}");
    }

    #[test]
    fn inbox_tickets_use_their_full_id() {
        let mut conn = setup();
        run(&mut conn, &["create", "inbox", "Call the bank"]).unwrap();
        let id = store::list_tickets(&conn, None).unwrap()[0].id.clone();
        assert!(run(&mut conn, &["tickets", "inbox"]).unwrap().contains(&format!("    {id}  Call the bank")));
        assert_eq!(run(&mut conn, &["move", &id, "ENG"]).unwrap(), format!("Moved {id} to Engineering, now ENG-1\n"));
        assert!(run(&mut conn, &["search", "bank"]).unwrap().starts_with("ENG-1  Call the bank · Backlog"));
    }
}
