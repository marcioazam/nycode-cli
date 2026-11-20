from app.server import describe


def main(argv):
    try:
        print(describe(argv[0]))
    except FileNotFoundError:
        return 2
    except ValueError:
        return 3
    return 0
