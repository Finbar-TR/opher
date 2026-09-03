// Social proof, deliberately WITHOUT a progress bar, target or percentage.
//
// There is no minimum demand — every order is charged whether two people join
// or twenty — so a progress bar would imply a gate that does not exist, and
// "X% there" would be meaningless. What is true and still persuasive is how
// many neighbours have already joined.

export function DemandNote({ joiners, grams }: { joiners: number; grams: number }) {
  if (joiners === 0) {
    return (
      <p className="text-sm font-medium text-saffron-ink">
        Be the first to join this one.
      </p>
    );
  }

  const kg = Math.round(grams / 100) / 10; // one decimal place

  return (
    <p className="text-sm font-medium text-saffron-ink">
      {joiners === 1 ? "1 neighbour has" : `${joiners} neighbours have`} joined
      {" · "}
      {kg} kg so far
    </p>
  );
}
