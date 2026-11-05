"""Run the route parts' functions on the facade's namespace.

The routes are split across ``backend/routes_parts/``, and ``backend/routes.py``
stays their one import path and their one patch surface: tests patch the
facade's names (``_RUNS``, ``_save_runs``, ``review_driver`` ...), so a moved
function that read its OWN module's globals would keep calling the unpatched
object. :func:`compose` rebinds every function a part defines, and the methods
of the classes it defines, onto the facade's globals, so the facade stays ONE
namespace, as the one-module file was.

The built-in used the gateway's ``kiro_crew._facade_compose.compose``, a private
module. This is the same pure rebinding without the orchestrator-class case the
routes never used; ``tests/test_routes_parts_composition_contract.py`` pins what it
guarantees.
"""

from __future__ import annotations

from collections.abc import Iterable
from types import FunctionType, ModuleType
from typing import Any


def compose(namespace: dict[str, Any], owners: Iterable[ModuleType]) -> None:
    """Run every function *owners* define on *namespace* (the facade's ``globals()``).

    The facade calls this once, after its own body has bound every name, so a
    single pass replaces every binding of an owner function -- in the facade, in
    the owners and in the owners' classes -- with its rebound copy, and no module
    is left holding the original.

    A function is an owner's when its code was compiled from that owner's file,
    whatever globals it carries: a facade imported a second time into the same
    process (a test's private copy) rebinds the owners onto its fresh namespace.
    """
    owners = tuple(owners)
    rebound: dict[int, tuple[FunctionType, FunctionType]] = {}
    classes: list[type] = []
    for owner in owners:
        path = owner.__file__
        for value in list(vars(owner).values()):
            if isinstance(value, FunctionType) and value.__code__.co_filename == path:
                rebound[id(value)] = (value, rebind(value, namespace))
            elif isinstance(value, type) and value.__module__ == owner.__name__:
                classes.append(value)
                for member in vars(value).values():
                    for fn in _functions_of(member):
                        if fn.__code__.co_filename == path:
                            rebound[id(fn)] = (fn, rebind(fn, namespace))

    def _swap(value: Any) -> Any:
        if isinstance(value, FunctionType):
            pair = rebound.get(id(value))
            return pair[1] if pair is not None and pair[0] is value else value
        if isinstance(value, (staticmethod, classmethod)):
            fn = _swap(value.__func__)
            return value if fn is value.__func__ else type(value)(fn)
        if isinstance(value, property):
            parts = (_swap(value.fget), _swap(value.fset), _swap(value.fdel))
            if parts == (value.fget, value.fset, value.fdel):
                return value
            return property(*parts, value.__doc__)
        return value

    for holder in [namespace, *(vars(owner) for owner in owners)]:
        for name, value in list(holder.items()):
            swapped = _swap(value)
            if swapped is not value:
                holder[name] = swapped
    for cls in classes:
        for name, value in list(vars(cls).items()):
            swapped = _swap(value)
            if swapped is not value:
                setattr(cls, name, swapped)


def _functions_of(member: Any) -> list[FunctionType]:
    """The plain functions a class member wraps: itself, a static/class method, a property."""
    if isinstance(member, FunctionType):
        return [member]
    if isinstance(member, (staticmethod, classmethod)) and isinstance(
        member.__func__, FunctionType
    ):
        return [member.__func__]
    if isinstance(member, property):
        return [
            fn for fn in (member.fget, member.fset, member.fdel) if isinstance(fn, FunctionType)
        ]
    return []


def rebind(fn: FunctionType, namespace: dict[str, Any]) -> FunctionType:
    """A copy of *fn* whose globals are *namespace*; every other attribute kept."""
    new = FunctionType(fn.__code__, namespace, fn.__name__, fn.__defaults__, fn.__closure__)
    new.__kwdefaults__ = fn.__kwdefaults__
    new.__annotations__ = fn.__annotations__
    new.__dict__.update(fn.__dict__)
    new.__doc__ = fn.__doc__
    new.__qualname__ = fn.__qualname__
    new.__module__ = namespace["__name__"]
    new.__type_params__ = fn.__type_params__
    return new
