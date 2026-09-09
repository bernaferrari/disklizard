use disklizard_scanner::{Request, Scanner, ServerMessage};
use std::io::{self, BufRead, BufWriter, Write};

fn send(message: &ServerMessage) -> io::Result<()> {
    let stdout = io::stdout();
    let capacity = match message {
        ServerMessage::Done { .. } => 256 * 1024,
        _ => 8 * 1024,
    };
    let mut output = BufWriter::with_capacity(capacity, stdout.lock());
    serde_json::to_writer(&mut output, message)?;
    output.write_all(b"\n")?;
    output.flush()
}

mod capacity;

fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--available-capacity") {
        let bytes = args.next().and_then(|path| capacity::available(&path));
        println!("{}", serde_json::json!({ "available": bytes }));
        return;
    }
    let request = io::stdin()
        .lock()
        .lines()
        .next()
        .transpose()
        .and_then(|line| {
            line.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing scan request"))
        })
        .and_then(|line| {
            serde_json::from_str::<Request>(&line)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
        });

    let request = match request {
        Ok(request) => request,
        Err(error) => {
            let _ = send(&ServerMessage::Error {
                message: error.to_string(),
            });
            std::process::exit(2);
        }
    };

    let scanner = match Scanner::new(request, send) {
        Ok(scanner) => scanner,
        Err(error) => {
            let _ = send(&ServerMessage::Error {
                message: error.to_string(),
            });
            std::process::exit(2);
        }
    };
    let root_path = scanner.target_path().to_string_lossy().into_owned();

    match scanner.scan() {
        Ok(root) => {
            if send(&ServerMessage::Done {
                protocol: 2,
                root_path,
                root: Box::new(root),
            })
            .is_err()
            {
                std::process::exit(3);
            }
        }
        Err(error) => {
            let _ = send(&ServerMessage::Error {
                message: error.to_string(),
            });
            std::process::exit(1);
        }
    }
}
