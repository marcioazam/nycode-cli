fn fallible() -> Result<(), ()> {
    Ok(())
}

fn main() {
    _ = fallible();
    let _ = fallible();
}
