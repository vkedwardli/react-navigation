import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import invariant from '../utils/invariant';

import NavigationScenesReducer from './ScenesReducer';

// Used for all animations unless overriden
const DefaultTransitionSpec = {
  duration: 250,
  easing: Easing.inOut(Easing.ease),
  timing: Animated.timing,
};

class Transitioner extends React.Component {
  constructor(props, context) {
    super(props, context);

    // The initial layout isn't measured. Measured layout will be only available
    // when the component is mounted.
    const layout = {
      height: new Animated.Value(0),
      initHeight: 0,
      initWidth: 0,
      isMeasured: false,
      width: new Animated.Value(0),
    };

    this.state = {
      layout,
      position: new Animated.Value(this.props.navigation.state.index),
      progress: new Animated.Value(1),
      scenes: NavigationScenesReducer([], this.props.navigation.state),
    };

    this._prevTransitionProps = null;
    this._transitionProps = buildTransitionProps(props, this.state);
    this._isMounted = false;
    this._isTransitionRunning = false;
    this._queuedTransition = null;
  }

  componentWillMount() {
    this._onLayout = this._onLayout.bind(this);
    this._onTransitionEnd = this._onTransitionEnd.bind(this);
  }

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  componentWillReceiveProps(nextProps) {
    const nextScenes = NavigationScenesReducer(
      this.state.scenes,
      nextProps.navigation.state,
      this.props.navigation.state
    );

    if (nextScenes === this.state.scenes) {
      return;
    }

    const indexHasChanged =
      nextProps.navigation.state.index !== this.props.navigation.state.index;
    if (this._isTransitionRunning) {
      this._queuedTransition = { nextProps, nextScenes, indexHasChanged };
      return;
    }

    this._startTransition(nextProps, nextScenes, indexHasChanged);
  }

  _startTransition(nextProps, nextScenes, indexHasChanged) {
    const nextState = {
      ...this.state,
      scenes: nextScenes,
    };

    const { position, progress } = nextState;

    progress.setValue(0);

    this._prevTransitionProps = this._transitionProps;
    this._transitionProps = buildTransitionProps(nextProps, nextState);

    // get the transition spec.
    const transitionUserSpec = nextProps.configureTransition
      ? nextProps.configureTransition(
          this._transitionProps,
          this._prevTransitionProps
        )
      : null;

    const transitionSpec = {
      ...DefaultTransitionSpec,
      ...transitionUserSpec,
    };

    const { timing } = transitionSpec;
    delete transitionSpec.timing;

    const toValue = nextProps.navigation.state.index;
    const positionHasChanged = position.__getValue() !== toValue;

    let {index, routes} = nextProps.navigation.state
    const keyHasChanged = routes[index].key !== this.state.scenes[position.__getValue()].route.key
    
    // Replacement detected
    if(keyHasChanged == false && positionHasChanged){
      //use the final navigation state index for the current last scene, so it can receive pointerEvents
      this.state.scenes[this.state.scenes.length-1].index = nextProps.navigation.state.index

      //use the final navigation state index for the current position, so it can be rendered correctly
      this.state.position.setValue(nextProps.navigation.state.index)
    }

    // if swiped back, indexHasChanged == true && positionHasChanged == false
    const animations =
      indexHasChanged && positionHasChanged
        ? [
            timing(progress, {
              ...transitionSpec,
              toValue: 1,
            }),
            timing(position, {
              ...transitionSpec,
              toValue: nextProps.navigation.state.index,
            }),
          ]
        : [];

    // update scenes and play the transition
    this._isTransitionRunning = true;
    this.setState(nextState, async () => {
      if (nextProps.onTransitionStart) {
        const result = nextProps.onTransitionStart(
          this._transitionProps,
          this._prevTransitionProps
        );

        if (result instanceof Promise) {
          await result;
        }
      }
      Animated.parallel(animations).start(this._onTransitionEnd);
    });
  }

  render() {
    return (
      <View onLayout={this._onLayout} style={[styles.main]}>
        {this.props.render(this._transitionProps, this._prevTransitionProps)}
      </View>
    );
  }

  _onLayout(event) {
    const { height, width } = event.nativeEvent.layout;
    if (
      this.state.layout.initWidth === width &&
      this.state.layout.initHeight === height
    ) {
      return;
    }
    const layout = {
      ...this.state.layout,
      initHeight: height,
      initWidth: width,
      isMeasured: true,
    };

    layout.height.setValue(height);
    layout.width.setValue(width);

    const nextState = {
      ...this.state,
      layout,
    };

    this._transitionProps = buildTransitionProps(this.props, nextState);
    this.setState(nextState);
  }

  _onTransitionEnd() {
    if (!this._isMounted) {
      return;
    }
    const prevTransitionProps = this._prevTransitionProps;
    this._prevTransitionProps = null;

    const scenes = this.state.scenes.filter(isSceneNotStale);

    const nextState = {
      ...this.state,
      /**
       * Array.prototype.filter creates a new instance of an array
       * even if there were no elements removed. There are cases when
       * `this.state.scenes` will have no stale scenes (typically when
       * pushing a new route). As a result, components that rely on this prop
       * might enter an unnecessary render cycle.
       */
      scenes:
        this.state.scenes.length === scenes.length ? this.state.scenes : scenes,
    };

    this._transitionProps = buildTransitionProps(this.props, nextState);

    this.setState(nextState, async () => {
      if (this.props.onTransitionEnd) {
        const result = this.props.onTransitionEnd(
          this._transitionProps,
          prevTransitionProps
        );

        if (result instanceof Promise) {
          await result;
        }
      }

      if (this._queuedTransition) {
        this._startTransition(
          this._queuedTransition.nextProps,
          this._queuedTransition.nextScenes,
          this._queuedTransition.indexHasChanged
        );
        this._queuedTransition = null;
      } else {
        this._isTransitionRunning = false;
      }
    });
  }
}

function buildTransitionProps(props, state) {
  const { navigation } = props;

  const { layout, position, progress, scenes } = state;

  const scene = scenes.find(isSceneActive);

  invariant(scene, 'Could not find active scene');

  return {
    layout,
    navigation,
    position,
    progress,
    scenes,
    scene,
    index: scene.index,
  };
}

function isSceneNotStale(scene) {
  return !scene.isStale;
}

function isSceneActive(scene) {
  return scene.isActive;
}

const styles = StyleSheet.create({
  main: {
    flex: 1,
  },
});

export default Transitioner;
