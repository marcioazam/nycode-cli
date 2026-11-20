def apply(amount, code):
    if code == "PCT10":
        return amount * 90 // 100
    if code == "OFF500":
        return max(0, amount - 500)
    raise KeyError(code)
